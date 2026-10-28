import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth';
import { keyBytes, PushService } from './push';
import { DEFAULT_PREFS, type NotificationPrefs } from './reminders';
import { PrefsStore } from './stores/prefs.store';

const user = signal<{ id: string } | null>(null);
const prefs = signal<NotificationPrefs>({ ...DEFAULT_PREFS, enabled: true });
let authed: ReturnType<typeof vi.fn>;
let subscription: {
  endpoint: string;
  toJSON: () => unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
};
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let permission: NotificationPermission;

const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const calls = () =>
  authed.mock.calls.map(
    ([path, init]) =>
      `${(init as { method?: string } | undefined)?.method ?? 'GET'} ${String(path)}`,
  );

function service(available = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user, available, authed } },
      { provide: PrefsStore, useValue: { notificationPrefs: prefs } },
    ],
  });
  return TestBed.inject(PushService);
}

beforeEach(() => {
  localStorage.clear();
  user.set(null);
  prefs.set({ ...DEFAULT_PREFS, enabled: true });
  permission = 'granted';
  subscription = {
    endpoint: 'https://push.exemple.fr/abc',
    toJSON: () => ({ endpoint: 'https://push.exemple.fr/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(null)),
    subscribe: vi.fn(() => Promise.resolve(subscription)),
  };
  authed = vi.fn((path: string) =>
    Promise.resolve(path === '/push/key' ? ok({ publicKey: 'AQAB' }) : ok()),
  );
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { requestPermission: () => Promise.resolve(permission) });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
  // Les fichiers de test peuvent partager le même environnement : ne rien laisser derrière soi.
  delete (navigator as unknown as Record<string, unknown>)['serviceWorker'];
});

describe('keyBytes', () => {
  it('décode une clé base64url, avec ou sans remplissage', () => {
    expect([...keyBytes('AQAB')]).toEqual([1, 0, 1]);
    expect([...keyBytes('-_8')]).toEqual([251, 255]);
  });
});

describe('PushService', () => {
  it('est désactivé par défaut et ne contacte personne', async () => {
    const push = service();
    user.set({ id: 'u1' });
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(push.enabled()).toBe(false);
    expect(authed).not.toHaveBeenCalled();
  });

  it('s’abonne puis transmet l’abonnement avec l’heure, le fuseau et le contenu choisis', async () => {
    const push = service();
    user.set({ id: 'u1' });
    prefs.set({ ...DEFAULT_PREFS, enabled: true, time: '20:15', followUps: false });
    await push.enable();
    TestBed.tick();
    await vi.waitFor(() => {
      expect(push.state()).toBe('on');
    });
    expect(localStorage.getItem('serverPush')).toBe('1');
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 0, 1]),
    });
    const put = authed.mock.calls.find(([p]) => p === '/push/subscription');
    expect(put?.[1]).toEqual({
      method: 'PUT',
      body: {
        endpoint: 'https://push.exemple.fr/abc',
        keys: { p256dh: 'p', auth: 'a' },
        time: '20:15',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tasks: true,
        followUps: false,
      },
    });
  });

  it('réutilise un abonnement existant et suit les changements d’heure', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    localStorage.setItem('serverPush', '1');
    const push = service();
    user.set({ id: 'u1' });
    TestBed.tick();
    await vi.waitFor(() => {
      expect(push.state()).toBe('on');
    });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    prefs.set({ ...prefs(), time: '07:00' });
    TestBed.tick();
    await vi.waitFor(() => {
      expect(calls().filter((c) => c === 'PUT /push/subscription')).toHaveLength(2);
    });
  });

  it('se retire du serveur quand les rappels sont coupés', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    localStorage.setItem('serverPush', '1');
    service();
    user.set({ id: 'u1' });
    prefs.set({ ...DEFAULT_PREFS, enabled: false });
    TestBed.tick();
    await vi.waitFor(() => {
      expect(subscription.unsubscribe).toHaveBeenCalled();
    });
    expect(calls()).toContain('DELETE /push/subscription');
  });

  it('se désactive : désabonnement local et serveur', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    const push = service();
    await push.disable();
    expect(localStorage.getItem('serverPush')).toBe('0');
    expect(push.enabled()).toBe(false);
    expect(push.state()).toBe('off');
    expect(authed).toHaveBeenCalledWith('/push/subscription', {
      method: 'DELETE',
      body: { endpoint: 'https://push.exemple.fr/abc' },
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('oublie l’appareil avant une déconnexion, sans changer le réglage', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    localStorage.setItem('serverPush', '1');
    const push = service();
    await push.forgetDevice();
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(push.enabled()).toBe(true);
  });

  it('respecte un refus d’autorisation', async () => {
    permission = 'denied';
    const push = service();
    await push.enable();
    expect(push.state()).toBe('denied');
    expect(push.enabled()).toBe(false);
  });

  it('est indisponible sans comptes ou sans push dans le navigateur', async () => {
    const push = service(false);
    await push.enable();
    expect(push.state()).toBe('unavailable');
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>)['PushManager'];
    expect(service().supported).toBe(false);
  });

  it('signale une erreur quand le serveur refuse', async () => {
    authed = vi.fn((path: string) =>
      Promise.resolve(
        path === '/push/key'
          ? ok({ publicKey: 'AQAB' })
          : { ok: false, status: 500, json: () => Promise.resolve({}) },
      ),
    );
    const push = service();
    user.set({ id: 'u1' });
    await push.enable();
    TestBed.tick();
    await vi.waitFor(() => {
      expect(push.state()).toBe('error');
    });
  });

  it('signale une erreur quand la clé du serveur manque', async () => {
    authed.mockResolvedValue(null);
    const push = service();
    user.set({ id: 'u1' });
    await push.enable();
    TestBed.tick();
    await vi.waitFor(() => {
      expect(push.state()).toBe('error');
    });
  });

  it('ne bloque pas quand le service worker ne répond pas', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: new Promise(() => undefined) },
        configurable: true,
      });
      const push = service();
      const done = push.disable();
      await vi.advanceTimersByTimeAsync(6000);
      await done;
      expect(push.state()).toBe('off');
    } finally {
      vi.useRealTimers();
    }
  });
});
