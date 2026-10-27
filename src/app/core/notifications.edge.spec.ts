import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFakeIndexedDb, waitFor } from './fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from './db';
import { PrefsRepo } from './data/prefs.repo';
import { TankRepo } from './data/tank.repo';
import { CareRepo } from './data/care.repo';
import { NotificationService } from './notifications';
import { AquariumStore } from './store';
import { PrefsStore } from './stores/prefs.store';

let db: AquariumDb;
let n = 0;
const shown: { title: string; options?: NotificationOptions }[] = [];

function fakeNotification(permission: string, request = permission) {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => request);
    constructor(title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  return FakeNotification;
}

function fakeServiceWorker(reg: Partial<{ showNotification: unknown; periodicSync: unknown }> | null) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => reg }, configurable: true });
}

beforeEach(() => {
  useFakeIndexedDb();
  shown.length = 0;
  db = new AquariumDb(`notif-edge-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
});
afterEach(async () => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (navigator as unknown as Record<string, unknown>)['serviceWorker'];
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await db.delete();
});

async function seedDue(prefs: Record<string, unknown> = { enabled: true, time: '00:00' }) {
  const tankId = await TestBed.inject(TankRepo).saveTank({ name: 'Salon', type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false });
  await TestBed.inject(CareRepo).saveTask({ tankId, type: 'water_test', label: 'Test', everyDays: 7, nextDue: '2020-01-01', active: true });
  await TestBed.inject(PrefsRepo).saveNotificationPrefs(prefs);
  const store = TestBed.inject(AquariumStore);
  const service = TestBed.inject(NotificationService);
  return { store, service };
}
const prepared = (store: AquariumStore) => waitFor(() => store.ready() && store.dueTasks().length === 1 && TestBed.inject(PrefsStore).notificationPrefs().enabled && Object.keys(TestBed.inject(PrefsStore).notificationPrefs().digests ?? {}).length > 0);

describe('prise en charge', () => {
  it('est désactivé sans Notification dans le navigateur', () => {
    vi.stubGlobal('Notification', undefined);
    delete (window as unknown as Record<string, unknown>)['Notification'];
    const service = TestBed.inject(NotificationService);
    expect(service.supported).toBe(false);
    expect(service.permission()).toBe('denied');
  });

  it('reprend l’autorisation du navigateur', () => {
    fakeNotification('granted');
    const service = TestBed.inject(NotificationService);
    expect(service.supported).toBe(true);
    expect(service.permission()).toBe('granted');
    expect(service.background()).toBe(false);
  });
});

describe('enable / disable', () => {
  it('ne fait rien si le navigateur ne gère pas les notifications', async () => {
    vi.stubGlobal('Notification', undefined);
    delete (window as unknown as Record<string, unknown>)['Notification'];
    const service = TestBed.inject(NotificationService);
    expect(await service.enable()).toBe(false);
    expect(await db.prefs.count()).toBe(0);
  });

  it('active les rappels une fois l’autorisation accordée', async () => {
    const N = fakeNotification('default', 'granted');
    const service = TestBed.inject(NotificationService);
    expect(await service.enable()).toBe(true);
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    expect(service.permission()).toBe('granted');
    expect((await db.prefs.get('notifications')) as { enabled: boolean }).toMatchObject({ enabled: true });
  });

  it('n’active rien si l’autorisation est refusée', async () => {
    fakeNotification('default', 'denied');
    const service = TestBed.inject(NotificationService);
    expect(await service.enable()).toBe(false);
    expect(service.permission()).toBe('denied');
    expect(await db.prefs.count()).toBe(0);
  });

  describe('synchronisation en arrière-plan', () => {
    const periodic = () => ({ register: vi.fn(async () => undefined), unregister: vi.fn(async () => undefined), getTags: vi.fn(async () => [] as string[]) });
    const permissionState = (state: string) => Object.defineProperty(navigator, 'permissions', { value: { query: vi.fn(async () => ({ state })) }, configurable: true });

    it('s’enregistre toutes les 6 heures quand elle est autorisée', async () => {
      fakeNotification('default', 'granted');
      const sync = periodic();
      fakeServiceWorker({ periodicSync: sync });
      permissionState('granted');
      const service = TestBed.inject(NotificationService);
      await service.enable();
      expect(sync.register).toHaveBeenCalledWith('aquarium-reminders', { minInterval: 6 * 3600_000 });
      expect(service.background()).toBe(true);
    });

    it('ne s’enregistre pas sans autorisation, sans prise en charge ou si la demande échoue', async () => {
      fakeNotification('default', 'granted');
      const sync = periodic();
      fakeServiceWorker({ periodicSync: sync });
      permissionState('prompt');
      const service = TestBed.inject(NotificationService);
      await service.enable();
      expect(sync.register).not.toHaveBeenCalled();
      expect(service.background()).toBe(false);

      fakeServiceWorker({});
      expect(await service.enable()).toBe(true);
      expect(service.background()).toBe(false);

      fakeServiceWorker({ periodicSync: sync });
      Object.defineProperty(navigator, 'permissions', { value: { query: async () => { throw new Error('non pris en charge'); } }, configurable: true });
      expect(await service.enable()).toBe(true);
      expect(service.background()).toBe(false);
    });

    it('se désinscrit à la désactivation, même si la désinscription échoue', async () => {
      fakeNotification('granted');
      const sync = periodic();
      sync.getTags.mockResolvedValue(['aquarium-reminders']);
      fakeServiceWorker({ periodicSync: sync });
      const service = TestBed.inject(NotificationService);
      await waitFor(() => service.background());
      await service.disable();
      expect(sync.unregister).toHaveBeenCalledWith('aquarium-reminders');
      expect(service.background()).toBe(false);
      expect((await db.prefs.get('notifications')) as { enabled: boolean }).toMatchObject({ enabled: false });

      sync.unregister.mockRejectedValue(new Error('x'));
      await expect(service.disable()).resolves.toBeUndefined();
    });

    it('désactive sans service worker', async () => {
      fakeNotification('granted');
      const service = TestBed.inject(NotificationService);
      await service.disable();
      expect((await db.prefs.get('notifications')) as { enabled: boolean }).toMatchObject({ enabled: false });
    });

    it('reconnaît au démarrage une synchronisation déjà enregistrée, ou non', async () => {
      fakeNotification('granted');
      const sync = periodic();
      sync.getTags.mockResolvedValue(['autre']);
      fakeServiceWorker({ periodicSync: sync });
      const service = TestBed.inject(NotificationService);
      await new Promise((r) => setTimeout(r, 20));
      expect(service.background()).toBe(false);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
      sync.getTags.mockRejectedValue(new Error('x'));
      const again = TestBed.inject(NotificationService);
      await new Promise((r) => setTimeout(r, 20));
      expect(again.background()).toBe(false);
    });
  });
});

describe('affichage', () => {
  it('montre la notification du jour avec son texte, via le service worker quand il existe', async () => {
    fakeNotification('granted');
    const showNotification = vi.fn(async () => undefined);
    fakeServiceWorker({ showNotification });
    const { store, service } = await seedDue();
    await prepared(store);
    await service.check();
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith('Une chose à faire pour tes bacs', { body: 'Test', icon: 'icons/icon-192x192.png', badge: 'icons/icon-192x192.png', tag: 'aquarium-daily' });
    expect(shown).toEqual([]);
  });

  it('sans service worker, utilise la notification du navigateur', async () => {
    fakeNotification('granted');
    const { store, service } = await seedDue();
    await prepared(store);
    await service.check();
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Une chose à faire pour tes bacs');
    expect(shown[0].options?.tag).toBe('aquarium-daily');
  });

  it('retient le jour affiché dans les préférences', async () => {
    fakeNotification('granted');
    const { store, service } = await seedDue();
    await prepared(store);
    await service.check();
    await waitFor(() => TestBed.inject(PrefsStore).notificationPrefs().lastShown === store.today());
  });

  it('ne dit rien sans autorisation', async () => {
    fakeNotification('default');
    const { store, service } = await seedDue();
    await prepared(store);
    await service.check();
    expect(shown).toEqual([]);
  });

  it('ne dit rien avant l’heure choisie, puis le dit une fois l’heure passée', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 27, 8, 0) });
    fakeNotification('granted');
    const { store, service } = await seedDue({ enabled: true, time: '09:00' });
    await prepared(store);
    await service.check();
    expect(shown).toEqual([]);
    vi.setSystemTime(new Date(2026, 9, 27, 9, 30));
    await service.check();
    expect(shown).toHaveLength(1);
  });

  it('ne dit rien si rien n’est à faire ce jour-là', async () => {
    fakeNotification('granted');
    const tankId = await TestBed.inject(TankRepo).saveTank({ name: 'Salon', type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false });
    await TestBed.inject(CareRepo).saveTask({ tankId, type: 'water_test', label: 'Test', everyDays: 7, nextDue: '2999-01-01', active: true });
    await TestBed.inject(PrefsRepo).saveNotificationPrefs({ enabled: true, time: '00:00' });
    const store = TestBed.inject(AquariumStore);
    const service = TestBed.inject(NotificationService);
    await waitFor(() => store.ready() && TestBed.inject(PrefsStore).notificationPrefs().enabled && TestBed.inject(PrefsStore).notificationPrefs().digestsUntil !== undefined);
    await service.check();
    expect(shown).toEqual([]);
  });

  it('test() montre la notification du jour ou un exemple', async () => {
    fakeNotification('granted');
    const { store, service } = await seedDue();
    await prepared(store);
    await service.test();
    expect(shown[0].title).toBe('Une chose à faire pour tes bacs');
    TestBed.resetTestingModule();
    shown.length = 0;
    TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: new AquariumDb(`notif-edge-${n++}`) }] });
    await TestBed.inject(NotificationService).test();
    expect(shown[0]).toMatchObject({ title: 'Rappels activés', options: { body: expect.stringContaining('Rien à faire aujourd’hui') } });
  });

  it('revient à l’écran : vérifie aussitôt si la page est visible, pas si elle est cachée', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 27, 8, 0) });
    fakeNotification('granted');
    const { store } = await seedDue({ enabled: true, time: '09:00' });
    await prepared(store);
    await new Promise((r) => setTimeout(r, 60)); // laisse l'ouverture de l'appli finir sa propre vérification
    vi.setSystemTime(new Date(2026, 9, 27, 9, 30));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    expect(shown).toEqual([]);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => shown.length === 1);
  });

  it('cesse d’écouter la page quand le service est détruit', async () => {
    fakeNotification('granted');
    const { store } = await seedDue();
    await prepared(store);
    TestBed.resetTestingModule();
    shown.length = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    expect(shown).toEqual([]);
  });
});

describe('préparation des jours à venir', () => {
  it('enregistre les 30 prochains jours et la date jusqu’où ils sont prêts', async () => {
    fakeNotification('granted');
    const { store } = await seedDue();
    await prepared(store);
    const prefs = TestBed.inject(PrefsStore).notificationPrefs();
    expect(Object.keys(prefs.digests!)).toHaveLength(30);
    const last = new Date(store.today() + 'T12:00:00');
    last.setDate(last.getDate() + 29);
    const iso = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    expect(prefs.digestsUntil).toBe(iso);
  });

  it('ne prépare rien tant que les rappels sont désactivés', async () => {
    fakeNotification('granted');
    const { store } = await seedDue({ enabled: false, time: '00:00' });
    await waitFor(() => store.ready() && store.dueTasks().length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(TestBed.inject(PrefsStore).notificationPrefs().digests).toBeUndefined();
    expect(TestBed.inject(PrefsStore).notificationPrefs().digestsUntil).toBeUndefined();
  });
});
