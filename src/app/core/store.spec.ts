import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AquariumDb } from './db';
import { AQUARIUM_DB, AquariumStore } from './store';
import type { Diagnosis, Inhabitant, Tank } from './models';

let db: AquariumDb;
let store: AquariumStore;
let n = 0;

beforeEach(() => {
  db = new AquariumDb(`test-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
  store = TestBed.inject(AquariumStore);
});

afterEach(async () => {
  store.destroy();
  await db.delete();
  TestBed.resetTestingModule();
});

const tank = (name: string): Omit<Tank, 'id' | 'updatedAt'> => ({ name, type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false });
const fish = (tankId: string, quantity: number): Omit<Inhabitant, 'id' | 'updatedAt'> => ({
  tankId, speciesId: 'neon', quantity, unit: 'individual', addedDate: '2026-10-01', status: 'healthy',
});

describe('store', () => {
  it('cumule deux ajouts rapides de la même espèce', async () => {
    const t = await store.saveTank(tank('Salon'));
    // Lancés ensemble : le second ne doit pas créer de doublon.
    await Promise.all([store.addInhabitant(fish(t, 5)), store.addInhabitant(fish(t, 3))]);
    const list = await db.inhabitants.toArray();
    expect(list).toHaveLength(1);
    expect(list[0].quantity).toBe(8);
    expect(await db.inhabitantEvents.count()).toBe(2);
  });

  it('déplace une partie des habitants vers un autre bac', async () => {
    const a = await store.saveTank(tank('Salon'));
    const b = await store.saveTank(tank('Nano'));
    const id = await store.addInhabitant(fish(a, 10));
    await store.moveInhabitant((await db.inhabitants.get(id))!, b, 4);
    const list = await db.inhabitants.orderBy('tankId').toArray();
    expect(list.find((i) => i.tankId === a)?.quantity).toBe(6);
    expect(list.find((i) => i.tankId === b)?.quantity).toBe(4);
  });

  it('un relevé valide la tâche « test de l’eau » due', async () => {
    const t = await store.saveTank(tank('Salon'));
    await store.saveTask({ tankId: t, type: 'water_test', label: 'Test', everyDays: 7, nextDue: '2020-01-01', active: true });
    await store.addWaterTest({ tankId: t, date: new Date().toISOString(), values: { no3: 10 } });
    const task = (await db.tasks.toArray())[0];
    expect(task.nextDue > store.today()).toBe(true);
    expect(await db.logs.count()).toBe(1);
  });

  it('crée le diagnostic et ses tâches ensemble, puis coche l’action une fois faite', async () => {
    const t = await store.saveTank(tank('Salon'));
    const d = {
      tankId: t, date: new Date().toISOString(), summary: 's', hypotheses: [],
      actions: [{ title: 'Couper', priority: 'now', task: { type: 'plant_trim', label: 'Couper' } }],
    } as unknown as Omit<Diagnosis, 'id' | 'updatedAt'>;
    const id = await store.addDiagnosis(d, [true]);
    const task = (await db.tasks.toArray())[0];
    expect(task.diagnosisId).toBe(id);
    await store.completeTask(task);
    expect((await db.diagnoses.get(id))?.actions[0].done).toBe(true);
    expect((await db.tasks.get(task.id))?.active).toBe(false);
  });

  it('supprime un habitant avec son historique', async () => {
    const t = await store.saveTank(tank('Salon'));
    const id = await store.addInhabitant(fish(t, 2));
    await store.deleteInhabitant(id);
    expect(await db.inhabitants.count()).toBe(0);
    expect(await db.inhabitantEvents.count()).toBe(0);
  });
});
