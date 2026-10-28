import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTS_ENABLED, API_URL } from './api-config';
import { AuthService } from './auth';

const API = 'https://api.exemple.test';
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alice@exemple.fr',
  role: 'user',
  createdAt: '2026-10-28T10:00:00.000Z',
};
const session = (accessToken = 'jeton-1', expiresIn = 900) => ({ accessToken, expiresIn, user });
const device = (over = {}) => ({
  id: 'd1',
  device: 'Firefox',
  createdAt: '2026-10-28T10:00:00.000Z',
  lastUsedAt: '2026-10-28T11:00:00.000Z',
  current: true,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

const reply = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

function service(opts: { url?: string | null; enabled?: boolean; signedIn?: boolean } = {}) {
  localStorage.clear();
  if (opts.signedIn) localStorage.setItem('signedIn', '1');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: API_URL, useValue: opts.url === undefined ? API : opts.url },
      { provide: ACCOUNTS_ENABLED, useValue: opts.enabled ?? true },
    ],
  });
  return TestBed.inject(AuthService);
}

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AuthService', () => {
  describe('disponibilité', () => {
    it('est indisponible sans adresse d’API ou tant que les comptes sont fermés', () => {
      expect(service({ url: null }).available).toBe(false);
      expect(service({ enabled: false }).available).toBe(false);
      expect(service().available).toBe(true);
    });

    it('est fermé par défaut dans l’appli publiée', () => {
      TestBed.resetTestingModule();
      expect(TestBed.inject(AuthService).available).toBe(false);
    });

    it('ne contacte jamais le serveur quand c’est indisponible', async () => {
      const auth = service({ enabled: false, signedIn: true });
      await auth.restore();
      expect(await auth.requestLink('a@exemple.fr')).toBe('error');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reprise de session', () => {
    it('ne demande rien à un appareil qui ne s’est jamais connecté', async () => {
      await service().restore();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renouvelle la session avec le cookie et garde le jeton en mémoire seulement', async () => {
      const auth = service({ signedIn: true });
      reply(200, session('jeton-secret'));
      await auth.restore();
      const { url, init } = lastCall();
      expect(url).toBe(`${API}/auth/refresh`);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(auth.user()?.email).toBe('alice@exemple.fr');
      expect(JSON.stringify({ ...localStorage })).not.toContain('jeton-secret');
      expect(JSON.stringify({ ...sessionStorage })).not.toContain('jeton-secret');
    });

    it('oublie la connexion quand le serveur la refuse', async () => {
      const auth = service({ signedIn: true });
      reply(401, {});
      await auth.restore();
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('0');
    });

    it('reste connecté localement quand le serveur est injoignable ou répond mal', async () => {
      const auth = service({ signedIn: true });
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.restore();
      reply(500, {});
      await auth.restore();
      reply(200, { accessToken: 1 });
      await auth.restore();
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('1');
    });

    it('regroupe les renouvellements simultanés en une seule requête', async () => {
      const auth = service({ signedIn: true });
      reply(200, session());
      await Promise.all([auth.restore(), auth.restore()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('prend un verrou du navigateur quand il existe, pour les autres onglets', async () => {
      const request = vi.fn((_name: string, cb: () => Promise<boolean>) => cb());
      vi.stubGlobal('navigator', { ...navigator, locks: { request } });
      const auth = service({ signedIn: true });
      reply(200, session());
      await auth.restore();
      expect(request).toHaveBeenCalledWith('aquarium-auth-refresh', expect.any(Function));
      expect(auth.user()).not.toBeNull();
    });
  });

  describe('lien de connexion', () => {
    it.each([
      [204, 'sent'],
      [400, 'invalid'],
      [429, 'limited'],
      [503, 'unavailable'],
      [500, 'error'],
    ])('la réponse %i donne « %s »', async (status, expected) => {
      const auth = service();
      reply(status);
      expect(await auth.requestLink('a@exemple.fr')).toBe(expected);
      const { url, init, headers } = lastCall();
      expect(url).toBe(`${API}/auth/magic-link`);
      expect(init.body).toBe(JSON.stringify({ email: 'a@exemple.fr' }));
      expect(headers['content-type']).toBe('application/json');
    });

    it('signale un serveur injoignable', async () => {
      const auth = service();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await auth.requestLink('a@exemple.fr')).toBe('error');
    });
  });

  describe('vérification du lien', () => {
    it('ouvre la session', async () => {
      const auth = service();
      reply(200, session());
      expect(await auth.verify('lien')).toBe('ok');
      expect(lastCall().init.body).toBe(JSON.stringify({ token: 'lien' }));
      expect(auth.user()?.id).toBe(user.id);
      expect(localStorage.getItem('signedIn')).toBe('1');
    });

    it('transmet le consentement quand il est donné', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien', { terms: true, age15: true });
      expect(JSON.parse(lastCall().init.body as string)).toEqual({
        token: 'lien',
        consent: { terms: true, age15: true },
      });
    });

    it.each([
      [409, 'consent_required'],
      [400, 'invalid'],
      [500, 'error'],
    ])('la réponse %i donne « %s »', async (status, expected) => {
      const auth = service();
      reply(status, {});
      expect(await auth.verify('lien')).toBe(expected);
      expect(auth.user()).toBeNull();
    });

    it('refuse une réponse mal formée ou un réseau absent', async () => {
      const auth = service();
      reply(200, { accessToken: 'x' });
      expect(await auth.verify('lien')).toBe('error');
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await auth.verify('lien')).toBe('error');
      expect(auth.user()).toBeNull();
    });

    it('refuse un compte au rôle inconnu', async () => {
      const auth = service();
      reply(200, { ...session(), user: { ...user, role: 'root' } });
      expect(await auth.verify('lien')).toBe('error');
    });
  });

  describe('déconnexion', () => {
    it('ferme la session côté serveur et localement', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien');
      reply(204);
      await auth.logout();
      expect(lastCall().url).toBe(`${API}/auth/logout`);
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('0');
    });

    it('ferme quand même la session locale hors ligne', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien');
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.logout();
      expect(auth.user()).toBeNull();
    });
  });

  describe('appareils connectés', () => {
    async function signedIn() {
      const auth = service();
      reply(200, session('jeton-A'));
      await auth.verify('lien');
      return auth;
    }

    it('liste les appareils avec le jeton d’accès, en ignorant les lignes mal formées', async () => {
      const auth = await signedIn();
      reply(200, { items: [device(), { id: 5 }] });
      await auth.loadDevices();
      const { url, headers } = lastCall();
      expect(url).toBe(`${API}/me/sessions`);
      expect(headers['authorization']).toBe('Bearer jeton-A');
      expect(auth.devices()).toEqual([device()]);
    });

    it('ignore une liste absente ou une erreur', async () => {
      const auth = await signedIn();
      reply(200, {});
      await auth.loadDevices();
      reply(500, {});
      await auth.loadDevices();
      expect(auth.devices()).toEqual([]);
    });

    it('renouvelle le jeton d’accès expiré avant d’appeler', async () => {
      const auth = service();
      reply(200, session('jeton-court', 1));
      await auth.verify('lien');
      reply(200, session('jeton-neuf'));
      reply(200, { items: [] });
      await auth.loadDevices();
      expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual([
        `${API}/auth/verify`,
        `${API}/auth/refresh`,
        `${API}/me/sessions`,
      ]);
      expect(lastCall().headers['authorization']).toBe('Bearer jeton-neuf');
    });

    it('réessaie une fois après un refus 401', async () => {
      const auth = await signedIn();
      reply(401, {});
      reply(200, session('jeton-B'));
      reply(200, { items: [device()] });
      await auth.loadDevices();
      expect(lastCall().headers['authorization']).toBe('Bearer jeton-B');
      expect(auth.devices()).toHaveLength(1);
    });

    it('ne fait rien sans connexion', async () => {
      const auth = service();
      reply(401, {});
      await auth.loadDevices();
      expect(auth.devices()).toEqual([]);
      expect(await auth.revokeDevice('d2')).toBe(false);
    });

    it('ne fait rien quand le réseau est coupé', async () => {
      const auth = await signedIn();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.loadDevices();
      expect(auth.devices()).toEqual([]);
    });

    it('déconnecte un autre appareil puis recharge la liste', async () => {
      const auth = await signedIn();
      reply(204);
      reply(200, { items: [device()] });
      expect(await auth.revokeDevice('d 2')).toBe(true);
      const calls = fetchMock.mock.calls as [string, RequestInit][];
      expect(calls[1]?.[0]).toBe(`${API}/me/sessions/d%202`);
      expect(calls[1]?.[1].method).toBe('DELETE');
      expect(auth.devices()).toHaveLength(1);
    });

    it('accepte un appareil déjà déconnecté (404) et signale les autres échecs', async () => {
      const auth = await signedIn();
      reply(404, {});
      reply(200, { items: [] });
      expect(await auth.revokeDevice('d2')).toBe(true);
      reply(500, {});
      expect(await auth.revokeDevice('d2')).toBe(false);
    });
  });
});
