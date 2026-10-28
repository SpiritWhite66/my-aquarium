import { Injectable, inject, signal } from '@angular/core';
import { ACCOUNTS_ENABLED, API_URL } from './api-config';
import { readPref, writePref } from './local-prefs';

export interface AccountUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface Device {
  id: string;
  device: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export type LinkResult = 'sent' | 'invalid' | 'limited' | 'unavailable' | 'error';
export type VerifyResult = 'ok' | 'consent_required' | 'invalid' | 'error';

const TIMEOUT_MS = 15_000;
/** On renouvelle le jeton d'accès un peu avant son expiration. */
const MARGIN_MS = 30_000;

interface Session {
  accessToken: string;
  expiresIn: number;
  user: AccountUser;
}

function isUser(v: unknown): v is AccountUser {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    typeof o['email'] === 'string' &&
    (o['role'] === 'user' || o['role'] === 'admin') &&
    typeof o['createdAt'] === 'string'
  );
}

function isSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['accessToken'] === 'string' && typeof o['expiresIn'] === 'number' && isUser(o['user'])
  );
}

function isDevice(v: unknown): v is Device {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    typeof o['device'] === 'string' &&
    typeof o['createdAt'] === 'string' &&
    typeof o['lastUsedAt'] === 'string' &&
    typeof o['current'] === 'boolean'
  );
}

/**
 * Compte de l'utilisateur. Facultatif : l'appli reste entièrement utilisable sans compte, et sans
 * connexion tant que `available` est faux. Le jeton d'accès ne vit qu'en mémoire (jamais dans le
 * stockage du navigateur) ; la session se prolonge grâce à un cookie que le serveur renouvelle.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = inject(API_URL);

  readonly available = this.apiUrl !== null && inject(ACCOUNTS_ENABLED);
  readonly user = signal<AccountUser | null>(null);
  readonly devices = signal<Device[]>([]);

  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<boolean> | null = null;

  /** Au démarrage : reprend la session d'un appareil déjà connecté, sans rien demander aux autres. */
  async restore(): Promise<void> {
    if (!this.available || readPref('signedIn') !== '1') return;
    await this.refresh();
  }

  async requestLink(email: string): Promise<LinkResult> {
    try {
      const res = await this.call('/auth/magic-link', { method: 'POST', body: { email } });
      if (res.status === 204) return 'sent';
      if (res.status === 400) return 'invalid';
      if (res.status === 429) return 'limited';
      if (res.status === 503) return 'unavailable';
      return 'error';
    } catch {
      return 'error';
    }
  }

  /** Échange le lien reçu par e-mail contre une session. `consent` n'est exigé qu'à l'inscription. */
  async verify(token: string, consent?: { terms: true; age15: true }): Promise<VerifyResult> {
    try {
      const res = await this.call('/auth/verify', {
        method: 'POST',
        body: consent ? { token, consent } : { token },
      });
      if (res.status === 409) return 'consent_required';
      if (res.status === 400) return 'invalid';
      if (!res.ok) return 'error';
      const body: unknown = await res.json();
      if (!isSession(body)) return 'error';
      this.accept(body);
      return 'ok';
    } catch {
      return 'error';
    }
  }

  async logout(): Promise<void> {
    try {
      await this.call('/auth/logout', { method: 'POST' });
    } catch {
      // Hors ligne : la session locale est quand même fermée, celle du serveur expirera.
    }
    this.clear();
  }

  async loadDevices(): Promise<void> {
    const res = await this.authed('/me/sessions');
    if (!res?.ok) return;
    const body = (await res.json()) as { items?: unknown };
    if (Array.isArray(body.items)) this.devices.set(body.items.filter(isDevice));
  }

  async revokeDevice(id: string): Promise<boolean> {
    const res = await this.authed(`/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res || (!res.ok && res.status !== 404)) return false;
    await this.loadDevices();
    return true;
  }

  /** Renouvellement unique même si plusieurs appels se croisent, et entre onglets (verrou du navigateur). */
  private refresh(): Promise<boolean> {
    this.refreshing ??= this.lockedRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private lockedRefresh(): Promise<boolean> {
    // Deux onglets qui renouvellent en même temps présenteraient le même cookie : le serveur y verrait
    // un vol et fermerait la session. Le verrou les fait passer l'un après l'autre.
    const locks = (navigator as { locks?: LockManager }).locks;
    return locks
      ? locks.request('aquarium-auth-refresh', () => this.doRefresh())
      : this.doRefresh();
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const res = await this.call('/auth/refresh', { method: 'POST' });
      if (res.status === 401) {
        this.clear();
        return false;
      }
      if (!res.ok) return false;
      const body: unknown = await res.json();
      if (!isSession(body)) return false;
      this.accept(body);
      return true;
    } catch {
      // Hors ligne ou serveur endormi : on reste connecté localement, on réessaiera plus tard.
      return false;
    }
  }

  /** Requête authentifiée ; renouvelle le jeton si besoin. `null` si on n'est pas (ou plus) connecté. */
  private async authed(path: string, init: { method?: string } = {}): Promise<Response | null> {
    if (this.accessToken === null || Date.now() > this.expiresAt - MARGIN_MS) {
      if (!(await this.refresh())) return null;
    }
    try {
      let res = await this.call(path, { ...init, bearer: this.accessToken });
      if (res.status === 401 && (await this.refresh())) {
        res = await this.call(path, { ...init, bearer: this.accessToken });
      }
      return res;
    } catch {
      return null;
    }
  }

  private call(
    path: string,
    init: { method?: string; body?: unknown; bearer?: string | null } = {},
  ): Promise<Response> {
    // Garde-fou : comptes fermés ou pas d'API, aucune requête ne part (les appelants gèrent l'échec).
    if (!this.available) return Promise.reject(new Error('Comptes indisponibles'));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.bearer) headers['authorization'] = `Bearer ${init.bearer}`;
    return fetch(`${this.apiUrl ?? ''}${path}`, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'include',
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private accept(session: Session): void {
    this.accessToken = session.accessToken;
    this.expiresAt = Date.now() + session.expiresIn * 1000;
    this.user.set(session.user);
    writePref('signedIn', '1');
  }

  private clear(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    this.user.set(null);
    this.devices.set([]);
    writePref('signedIn', '0');
  }
}
