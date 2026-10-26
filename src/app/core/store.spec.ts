// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFakeIndexedDb, waitFor } from './fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from './db';
import { AquariumStore, groupByTank } from './store';
import { BackupRepo } from './data/backup.repo';
import { CareRepo } from './data/care.repo';
import { LivestockRepo } from './data/livestock.repo';
import { PhotoRepo } from './data/photo.repo';
import { TankRepo } from './data/tank.repo';
import type { Diagnosis, Inhabitant, Tank } from './models';

// Le Blob de jsdom ne sait pas se lire (text, arrayBuffer, stream) : on prend celui de Node,
// le temps de ce fichier seulement (les autres tests ont besoin de celui de jsdom).
const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let db: AquariumDb;
let store: AquariumStore;
let repo: { backup: BackupRepo; care: CareRepo; livestock: LivestockRepo; photo: PhotoRepo; tank: TankRepo };
let n = 0;

beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb(`test-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
  store = TestBed.inject(AquariumStore);
  repo = { backup: TestBed.inject(BackupRepo), care: TestBed.inject(CareRepo), livestock: TestBed.inject(LivestockRepo), photo: TestBed.inject(PhotoRepo), tank: TestBed.inject(TankRepo) };
});

afterEach(async () => {
  TestBed.resetTestingModule(); // arrête l'horloge et les requêtes en direct
  await db.delete();
});

const tank = (name: string): Omit<Tank, 'id' | 'updatedAt'> => ({ name, type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false });
const fish = (tankId: string, quantity: number): Omit<Inhabitant, 'id' | 'updatedAt'> => ({
  tankId, speciesId: 'neon', quantity, unit: 'individual', addedDate: '2026-10-01', status: 'healthy',
});

describe('store', () => {
  it('cumule deux ajouts rapides de la même espèce', async () => {
    const t = await repo.tank.saveTank(tank('Salon'));
    // Lancés ensemble : le second ne doit pas créer de doublon.
    await Promise.all([repo.livestock.addInhabitant(fish(t, 5)), repo.livestock.addInhabitant(fish(t, 3))]);
    const list = await db.inhabitants.toArray();
    expect(list).toHaveLength(1);
    expect(list[0].quantity).toBe(8);
    expect(await db.inhabitantEvents.count()).toBe(2);
  });

  it('déplace une partie des habitants vers un autre bac', async () => {
    const a = await repo.tank.saveTank(tank('Salon'));
    const b = await repo.tank.saveTank(tank('Nano'));
    const id = await repo.livestock.addInhabitant(fish(a, 10));
    await repo.livestock.moveInhabitant((await db.inhabitants.get(id))!, b, 4);
    const list = await db.inhabitants.orderBy('tankId').toArray();
    expect(list.find((i) => i.tankId === a)?.quantity).toBe(6);
    expect(list.find((i) => i.tankId === b)?.quantity).toBe(4);
  });

  it('un relevé valide la tâche « test de l’eau » due', async () => {
    const t = await repo.tank.saveTank(tank('Salon'));
    await repo.care.saveTask({ tankId: t, type: 'water_test', label: 'Test', everyDays: 7, nextDue: '2020-01-01', active: true });
    await repo.care.addWaterTest({ tankId: t, date: new Date().toISOString(), values: { no3: 10 } });
    const task = (await db.tasks.toArray())[0];
    expect(task.nextDue > store.today()).toBe(true);
    expect(await db.logs.count()).toBe(1);
  });

  it('crée le diagnostic et ses tâches ensemble, puis coche l’action une fois faite', async () => {
    const t = await repo.tank.saveTank(tank('Salon'));
    const d = {
      tankId: t, date: new Date().toISOString(), summary: 's', hypotheses: [],
      actions: [{ title: 'Couper', priority: 'now', task: { type: 'plant_trim', label: 'Couper' } }],
    } as unknown as Omit<Diagnosis, 'id' | 'updatedAt'>;
    const id = await repo.care.addDiagnosis(d, [true]);
    const task = (await db.tasks.toArray())[0];
    expect(task.diagnosisId).toBe(id);
    await repo.care.completeTask(task);
    expect((await db.diagnoses.get(id))?.actions[0].done).toBe(true);
    expect((await db.tasks.get(task.id))?.active).toBe(false);
  });

  it('supprime un habitant avec son historique', async () => {
    const t = await repo.tank.saveTank(tank('Salon'));
    const id = await repo.livestock.addInhabitant(fish(t, 2));
    await repo.livestock.deleteInhabitant(id);
    expect(await db.inhabitants.count()).toBe(0);
    expect(await db.inhabitantEvents.count()).toBe(0);
  });
});

const jpg = (s: string) => new Blob([s], { type: 'image/jpeg' });

async function seedPhoto(tankId: string, id = 'p1') {
  await db.photos.put({ id, updatedAt: '', tankId, date: '2026-10-01T10:00:00Z', width: 10, height: 10 });
  await db.photoFiles.put({ id, full: jpg('FULL-' + id), thumb: jpg('THUMB-' + id) });
  await db.tanks.update(tankId, { coverPhotoId: id });
}

describe('sauvegarde', () => {
  it('exporte en ZIP puis restaure tout, images comprises', async () => {
    const t = await repo.tank.saveTank(tank('Salon'));
    await repo.livestock.addInhabitant(fish(t, 5));
    await seedPhoto(t);
    const { blob } = await repo.backup.exportArchive();
    await repo.tank.deleteTank(t);
    expect(await db.photoFiles.count()).toBe(0);

    const warnings = await repo.backup.importBackup(blob);
    expect(warnings).toEqual([]);
    expect((await db.tanks.get(t))?.coverPhotoId).toBe('p1');
    expect(await db.inhabitants.count()).toBe(1);
    expect(await (await repo.photo.photoFile('p1'))!.full.text()).toBe('FULL-p1');
  });

  it('accepte encore les anciennes sauvegardes JSON (photos en data URL)', async () => {
    const old = {
      format: 'my-aquarium', version: 1, exportedAt: '2026-01-01T00:00:00Z',
      data: {
        tanks: [{ id: 't', updatedAt: '', ...tank('Ancien') }],
        species: [], inhabitants: [], inhabitantEvents: [], waterTests: [], tasks: [], logs: [],
        photos: [{ id: 'p', updatedAt: '', tankId: 't', date: '2026-01-01T00:00:00Z', width: 1, height: 1, full: 'data:image/jpeg;base64,QUJD', thumb: 'data:image/jpeg;base64,QUI=' }],
      },
    };
    await repo.backup.importBackup(new Blob([JSON.stringify(old)]));
    expect((await db.tanks.get('t'))?.name).toBe('Ancien');
    expect(await (await repo.photo.photoFile('p'))!.full.text()).toBe('ABC');
    expect(Object.keys((await db.photos.get('p'))!)).not.toContain('full');
  });

  it('refuse un fichier abîmé sans rien effacer', async () => {
    await repo.tank.saveTank(tank('Salon'));
    const bad = { format: 'my-aquarium', version: 2, exportedAt: '', data: { tanks: [{ id: 'x', name: 3 }] } };
    await expect(repo.backup.importBackup(new Blob([JSON.stringify(bad)]))).rejects.toThrow(/abîmée/);
    expect(await db.tanks.count()).toBe(1);
  });

  it('écarte les lignes dont le bac n’existe pas', async () => {
    const file = {
      format: 'my-aquarium', version: 2, exportedAt: '',
      data: { tanks: [], waterTests: [{ id: 'w', updatedAt: '', tankId: 'absent', date: '2026-01-01', values: {} }] },
    };
    const warnings = await repo.backup.importBackup(new Blob([JSON.stringify(file)]));
    expect(warnings[0]).toMatch(/relevés sans bac/);
    expect(await db.waterTests.count()).toBe(0);
  });
});

describe('reprise des photos (base v7 → v8)', () => {
  it('sort les images de la table des photos sans rien perdre', async () => {
    const name = `migr-${n++}`;
    const { default: Dexie } = await import('dexie');
    const old = new Dexie(name);
    old.version(7).stores({ tanks: 'id, archived', photos: 'id, tankId, inhabitantId, date' });
    await old.table('photos').put({ id: 'a', tankId: 't', date: '2026-01-01', width: 1, height: 1, full: jpg('F'), thumb: jpg('T') });
    old.close();

    const upgraded = new AquariumDb(name);
    const meta = await upgraded.photos.get('a');
    expect(meta && 'full' in meta).toBe(false);
    expect(await (await upgraded.photoFiles.get('a'))!.thumb.text()).toBe('T');
    await upgraded.delete();
  });
});

describe('vues des bacs', () => {
  it('chaque bac ne voit que ses propres données', async () => {
    const a = await repo.tank.saveTank(tank('Salon'));
    const b = await repo.tank.saveTank(tank('Nano'));
    await db.waterTests.bulkPut([
      { id: 'w1', updatedAt: '', tankId: a, date: '2026-10-01', values: { no3: 10 } },
      { id: 'w2', updatedAt: '', tankId: b, date: '2026-10-02', values: { no3: 99 } },
      { id: 'w3', updatedAt: '', tankId: a, date: '2026-10-03', values: { no3: 20 } },
    ]);
    await waitFor(() => store.waterTests().length === 3);
    const views = new Map(store.tankViews().map((v) => [v.tank.id, v]));
    expect(views.get(a)!.tests.map((t) => t.id)).toEqual(['w1', 'w3']);
    expect(views.get(a)!.lastTest?.values.no3).toBe(20);
    expect(views.get(b)!.tests.map((t) => t.id)).toEqual(['w2']);
  });

  it('groupByTank garde l’ordre d’origine', () => {
    const g = groupByTank([{ tankId: 'a', n: 1 }, { tankId: 'b', n: 2 }, { tankId: 'a', n: 3 }]);
    expect(g.get('a')!.map((x) => x.n)).toEqual([1, 3]);
    expect(g.get('b')!.map((x) => x.n)).toEqual([2]);
  });
});
