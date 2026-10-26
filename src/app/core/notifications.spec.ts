import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFakeIndexedDb, waitFor } from './fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from './db';
import { PrefsRepo } from './data/prefs.repo';
import { TankRepo } from './data/tank.repo';
import { CareRepo } from './data/care.repo';
import { NotificationService } from './notifications';
import { AquariumStore } from './store';

let db: AquariumDb;
let n = 0;
const shown: string[] = [];

beforeEach(() => {
  useFakeIndexedDb();
  shown.length = 0;
  // Notification factice : accordée, et on note chaque affichage.
  class FakeNotification {
    static permission = 'granted';
    static requestPermission = async () => 'granted';
    constructor(title: string) {
      shown.push(title);
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  db = new AquariumDb(`notif-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
});

afterEach(async () => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  await db.delete();
});

describe('NotificationService', () => {
  it('n’affiche la notification du jour qu’une fois, même si deux vérifications se croisent', async () => {
    const tankId = await TestBed.inject(TankRepo).saveTank({ name: 'Salon', type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false });
    await TestBed.inject(CareRepo).saveTask({ tankId, type: 'water_test', label: 'Test', everyDays: 7, nextDue: '2020-01-01', active: true });
    await TestBed.inject(PrefsRepo).saveNotificationPrefs({ enabled: true, time: '00:00' });
    const store = TestBed.inject(AquariumStore);
    const service = TestBed.inject(NotificationService);
    await waitFor(() => store.ready() && store.dueTasks().length === 1 && store.notificationPrefs().enabled);

    await Promise.all([service.check(), service.check(), service.check()]);
    await service.check();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/chose/);
  });
});
