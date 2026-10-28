import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth';
import { readPref, writePref } from './local-prefs';
import { PrefsStore } from './stores/prefs.store';

export type PushState = 'off' | 'busy' | 'on' | 'denied' | 'unavailable' | 'error';

/** Clé publique VAPID (base64url) au format attendu par `pushManager.subscribe`. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Le service worker peut ne jamais être prêt (développement, navigation privée) : on n'attend pas. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new Error('délai dépassé'));
      }, ms),
    ),
  ]);
}

/**
 * Rappels envoyés par le serveur (notifications push), même appli fermée et sur tous les appareils
 * connectés. Facultatif, propre à l'appareil, et seulement avec un compte : sans lui, les rappels
 * locaux continuent comme avant. L'heure et le contenu suivent les réglages des rappels.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(PrefsStore).notificationPrefs;

  readonly supported =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  readonly enabled = signal(readPref('serverPush') === '1');
  readonly state = signal<PushState>('off');

  constructor() {
    // Garde le serveur à jour : connexion, heure ou contenu des rappels modifiés.
    effect(() => {
      const user = this.auth.user();
      const p = this.prefs();
      if (!this.enabled() || user === null || !this.supported) return;
      if (p.enabled) void this.register(p);
      else void this.unregister();
    });
  }

  async enable(): Promise<void> {
    if (!this.supported || !this.auth.available) {
      this.state.set('unavailable');
      return;
    }
    if ((await Notification.requestPermission()) !== 'granted') {
      this.state.set('denied');
      return;
    }
    writePref('serverPush', '1');
    this.enabled.set(true);
  }

  async disable(): Promise<void> {
    writePref('serverPush', '0');
    this.enabled.set(false);
    await this.unregister();
  }

  /** Avant la déconnexion : l'appareil ne doit plus recevoir les rappels du compte. */
  async forgetDevice(): Promise<void> {
    await this.unregister();
  }

  private async register(p: { time: string; tasks: boolean; followUps: boolean }): Promise<void> {
    this.state.set('busy');
    try {
      const keyRes = await this.auth.authed('/push/key');
      if (!keyRes?.ok) throw new Error('clé');
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      const reg = await within(navigator.serviceWorker.ready, 10_000);
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = sub.toJSON();
      const res = await this.auth.authed('/push/subscription', {
        method: 'PUT',
        body: {
          endpoint: json.endpoint,
          keys: json.keys,
          time: p.time,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          tasks: p.tasks,
          followUps: p.followUps,
        },
      });
      this.state.set(res?.ok ? 'on' : 'error');
    } catch {
      this.state.set('error');
    }
  }

  private async unregister(): Promise<void> {
    try {
      const reg = await within(navigator.serviceWorker.ready, 5_000);
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await this.auth.authed('/push/subscription', {
          method: 'DELETE',
          body: { endpoint: sub.endpoint },
        });
        await sub.unsubscribe();
      }
    } catch {
      // Hors ligne ou service worker absent : le serveur oubliera l'abonnement quand il expirera.
    }
    this.state.set('off');
  }
}
