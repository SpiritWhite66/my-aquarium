// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFakeIndexedDb } from '../fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from '../db';
import { CareRepo } from './care.repo';
import { GearRepo } from './gear.repo';
import { LivestockRepo } from './livestock.repo';
import { PhotoRepo } from './photo.repo';
import { TankRepo, defaultTasks } from './tank.repo';
import type { Inhabitant, Tank } from '../models';

// Le Blob de jsdom ne sait pas se lire : on prend celui de Node pour ce fichier.
const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let db: AquariumDb;
let n = 0;
const inject = <T>(t: new (...a: never[]) => T) => TestBed.inject(t);

beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb(`repos-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
});
afterEach(async () => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await db.delete();
});

const tankData = (name: string, o: Partial<Tank> = {}): Omit<Tank, 'id' | 'updatedAt'> => ({ name, type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false, ...o });
const fish = (tankId: string, quantity = 5, o: Partial<Inhabitant> = {}): Omit<Inhabitant, 'id' | 'updatedAt'> => ({ tankId, speciesId: 'neon', quantity, unit: 'individual', addedDate: '2026-10-01', status: 'healthy', ...o });

describe('TankRepo', () => {
  it('crée un bac avec les tâches habituelles selon son type et le CO2', async () => {
    const id = await inject(TankRepo).saveTank(tankData('Salon', { co2: true }), true);
    const types = (await db.tasks.where('tankId').equals(id).toArray()).map((t) => t.type).sort();
    expect(types).toEqual(['co2_refill', 'fertilize', 'filter_clean', 'glass_clean', 'plant_trim', 'water_change', 'water_test']);
  });

  it('ne crée pas de tâches si on ne les demande pas', async () => {
    const id = await inject(TankRepo).saveTank(tankData('Salon'));
    expect(await db.tasks.count()).toBe(0);
    expect((await db.tanks.get(id))?.name).toBe('Salon');
  });

  it('defaultTasks : un bac de quarantaine n’a ni engrais ni taille, les échéances partent d’aujourd’hui', () => {
    const list = defaultTasks('t', 'quarantine', false, '2026-10-01');
    expect(list.map((t) => t.type)).toEqual(['water_change', 'water_test', 'glass_clean', 'filter_clean']);
    expect(list.find((t) => t.type === 'filter_clean')?.nextDue).toBe('2026-10-31');
    expect(list[0].label).toBe('Changement d’eau 30 %');
    expect(list.every((t) => t.active && t.tankId === 't')).toBe(true);
  });

  it('archive puis désarchive', async () => {
    const repo = inject(TankRepo);
    const id = await repo.saveTank(tankData('Salon'));
    await repo.archiveTank(id);
    expect((await db.tanks.get(id))?.archived).toBe(true);
    await repo.archiveTank(id, false);
    expect((await db.tanks.get(id))?.archived).toBe(false);
  });

  it('supprime un bac avec tout ce qui lui est rattaché, mais garde son matériel en réserve', async () => {
    const tanks = inject(TankRepo);
    const a = await tanks.saveTank(tankData('A'));
    const b = await tanks.saveTank(tankData('B'));
    for (const t of [a, b]) {
      await inject(LivestockRepo).addInhabitant(fish(t));
      await inject(CareRepo).addWaterTest({ tankId: t, date: '2026-10-01T10:00:00Z', values: { ph: 7 } });
      await inject(CareRepo).addLog({ tankId: t, type: 'custom', label: 'x', date: '2026-10-01T10:00:00Z' });
      await db.photos.put({ id: `p${t}`, updatedAt: '', tankId: t, date: '2026-10-01', width: 1, height: 1 });
      await db.photoFiles.put({ id: `p${t}`, full: new Blob(['x']), thumb: new Blob(['x']) });
    }
    const eq = await inject(GearRepo).saveEquipment({ tankId: a, type: 'filter', name: 'Filtre' });
    await db.settingChanges.put({ id: 's', updatedAt: '', tankId: a, equipmentId: eq, equipmentName: 'Filtre', date: '2026-10-01', field: 'light.intensityPct' } as never);

    await tanks.deleteTank(a);

    expect(await db.tanks.toArray().then((l) => l.map((t) => t.id))).toEqual([b]);
    expect(await db.inhabitants.count()).toBe(1);
    expect(await db.inhabitantEvents.where('tankId').equals(a).count()).toBe(0);
    expect(await db.waterTests.where('tankId').equals(a).count()).toBe(0);
    expect(await db.logs.count()).toBe(1);
    expect(await db.photos.count()).toBe(1);
    expect(await db.photoFiles.count()).toBe(1);
    expect(await db.settingChanges.count()).toBe(0);
    const kept = await db.equipment.get(eq);
    expect(kept?.name).toBe('Filtre');
    expect(kept?.tankId).toBeUndefined();
  });
});

describe('LivestockRepo', () => {
  it('une espèce de unité différente ne se cumule pas', async () => {
    const repo = inject(LivestockRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await repo.addInhabitant(fish(t, 5));
    await repo.addInhabitant(fish(t, 3, { unit: 'stem' }));
    expect(await db.inhabitants.count()).toBe(2);
  });

  it('un habitant mort ne reçoit pas les nouveaux arrivants', async () => {
    const repo = inject(LivestockRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const id = await repo.addInhabitant(fish(t, 2));
    await repo.updateInhabitant(id, { status: 'dead' });
    const id2 = await repo.addInhabitant(fish(t, 4));
    expect(id2).not.toBe(id);
    expect((await db.inhabitants.get(id2))?.quantity).toBe(4);
  });

  it('enregistre l’origine dans l’événement d’arrivée', async () => {
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await inject(LivestockRepo).addInhabitant(fish(t, 2, { origin: 'Animalerie' }));
    const ev = (await db.inhabitantEvents.toArray())[0];
    expect(ev).toMatchObject({ type: 'added', quantityDelta: 2, note: 'Animalerie', tankId: t });
  });

  it('un décès baisse la quantité, puis passe l’habitant en « mort » à zéro', async () => {
    const repo = inject(LivestockRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const id = await repo.addInhabitant(fish(t, 2));
    await repo.recordEvent((await db.inhabitants.get(id))!, 'death', -1, 'vieux');
    expect(await db.inhabitants.get(id)).toMatchObject({ quantity: 1, status: 'healthy' });
    await repo.recordEvent((await db.inhabitants.get(id))!, 'death', -5);
    expect(await db.inhabitants.get(id)).toMatchObject({ quantity: 0, status: 'dead' });
  });

  it('une naissance ajoute, une note ne change pas la quantité', async () => {
    const repo = inject(LivestockRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const id = await repo.addInhabitant(fish(t, 2));
    await repo.recordEvent((await db.inhabitants.get(id))!, 'birth', 3);
    await repo.recordEvent((await db.inhabitants.get(id))!, 'note', 0, 'ok');
    expect((await db.inhabitants.get(id))?.quantity).toBe(5);
    const note = (await db.inhabitantEvents.toArray()).find((e) => e.type === 'note');
    expect(note?.quantityDelta).toBeUndefined();
  });

  it('un déplacement total change le bac, l’historique et les photos suivent', async () => {
    const repo = inject(LivestockRepo);
    const tanks = inject(TankRepo);
    const a = await tanks.saveTank(tankData('Salon'));
    const b = await tanks.saveTank(tankData('Quarantaine'));
    const id = await repo.addInhabitant(fish(a, 3));
    await db.photos.put({ id: 'p', updatedAt: '', tankId: a, inhabitantId: id, date: '2026-10-01', width: 1, height: 1 });
    await repo.moveInhabitant((await db.inhabitants.get(id))!, b);
    expect((await db.inhabitants.get(id))?.tankId).toBe(b);
    expect((await db.photos.get('p'))?.tankId).toBe(b);
    const events = await db.inhabitantEvents.where('inhabitantId').equals(id).toArray();
    expect(events.every((e) => e.tankId === b)).toBe(true);
    expect(events.find((e) => e.type === 'moved')?.note).toBe('Salon → Quarantaine');
  });

  it('un déplacement partiel vers un bac qui a déjà l’espèce cumule', async () => {
    const repo = inject(LivestockRepo);
    const tanks = inject(TankRepo);
    const a = await tanks.saveTank(tankData('A'));
    const b = await tanks.saveTank(tankData('B'));
    const ia = await repo.addInhabitant(fish(a, 10));
    const ib = await repo.addInhabitant(fish(b, 2));
    await repo.moveInhabitant((await db.inhabitants.get(ia))!, b, 4);
    expect((await db.inhabitants.get(ia))?.quantity).toBe(6);
    expect((await db.inhabitants.get(ib))?.quantity).toBe(6);
  });

  it('un déplacement vers le même bac ou de zéro ne fait rien', async () => {
    const repo = inject(LivestockRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const b = await inject(TankRepo).saveTank(tankData('B'));
    const id = await repo.addInhabitant(fish(t, 3));
    const inh = (await db.inhabitants.get(id))!;
    await repo.moveInhabitant(inh, t);
    await repo.moveInhabitant(inh, b, 0);
    expect(await db.inhabitants.count()).toBe(1);
    expect((await db.inhabitants.get(id))?.tankId).toBe(t);
  });

  it('crée la fiche personnelle puis la remplace par la fiche intégrée à la suppression', async () => {
    const repo = inject(LivestockRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const sp = await repo.saveSpecies({ scientificName: 'Perso', kind: 'fish', commonNames: ['Perso'], overrides: 'neon' });
    expect(sp.startsWith('custom-')).toBe(true);
    expect((await db.species.get(sp))?.source).toBe('custom');
    const id = await repo.addInhabitant(fish(t, 2, { speciesId: sp }));
    await repo.deleteSpecies(sp);
    expect(await db.species.get(sp)).toBeUndefined();
    expect((await db.inhabitants.get(id))?.speciesId).toBe('neon');
  });

  it('ne supprime jamais une fiche intégrée', async () => {
    const repo = inject(LivestockRepo);
    await db.species.put({ id: 'builtin', source: 'builtin', scientificName: 'x', kind: 'fish', commonNames: ['x'] } as never);
    await repo.deleteSpecies('builtin');
    await repo.deleteSpecies('absente');
    expect(await db.species.get('builtin')).toBeDefined();
  });
});

describe('GearRepo', () => {
  it('historise un changement de réglage avec sa date d’effet et sa note', async () => {
    const repo = inject(GearRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const base = { tankId: t, type: 'light' as const, name: 'Rampe', light: { intensityPct: 80 } };
    const id = await repo.saveEquipment(base);
    expect(await db.settingChanges.count()).toBe(0);
    await repo.saveEquipment({ ...base, id, light: { intensityPct: 60 } }, { effective: '2026-10-05', note: '  moins de lumière ' });
    const [c] = await db.settingChanges.toArray();
    expect(c).toMatchObject({ field: 'light.intensityPct', equipmentId: id, equipmentName: 'Rampe', tankId: t, note: 'moins de lumière' });
    expect(new Date(c.date).getTime()).toBe(new Date('2026-10-05T12:00').getTime());
  });

  it('un réglage inchangé n’ajoute rien ; sans date d’effet, la date est maintenant', async () => {
    const repo = inject(GearRepo);
    const base = { type: 'light' as const, name: 'Rampe', light: { intensityPct: 80 } };
    const id = await repo.saveEquipment(base);
    await repo.saveEquipment({ ...base, id });
    expect(await db.settingChanges.count()).toBe(0);
    await repo.saveEquipment({ ...base, id, light: { intensityPct: 50 } });
    const [c] = await db.settingChanges.toArray();
    expect(Math.abs(Date.now() - new Date(c.date).getTime())).toBeLessThan(5000);
    expect(c.note).toBeUndefined();
  });

  it('corrige, supprime un changement et supprime un équipement', async () => {
    const repo = inject(GearRepo);
    const id = await repo.saveEquipment({ type: 'light', name: 'R', light: { intensityPct: 80 } });
    await repo.saveEquipment({ type: 'light', name: 'R', id, light: { intensityPct: 70 } });
    const [c] = await db.settingChanges.toArray();
    await repo.updateSettingChange(c.id, { note: 'corrigé' });
    expect((await db.settingChanges.get(c.id))?.note).toBe('corrigé');
    await repo.deleteSettingChange(c.id);
    expect(await db.settingChanges.count()).toBe(0);
    await repo.deleteEquipment(id);
    expect(await db.equipment.count()).toBe(0);
  });

  it('consommables : création, niveau, suppression', async () => {
    const repo = inject(GearRepo);
    const id = await repo.saveConsumable({ name: 'NPK', category: 'fertilizer', level: 'full' });
    await repo.setConsumableLevel(id, 'low');
    expect((await db.consumables.get(id))?.level).toBe('low');
    await repo.deleteConsumable(id);
    expect(await db.consumables.count()).toBe(0);
  });

  it('mesures CO2 : ajout et suppression', async () => {
    const repo = inject(GearRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await repo.addCo2Reading({ id: 'r', tankId: t, date: '2026-10-01T10:00:00Z', bubblesPerMinute: 2 });
    expect((await db.co2Readings.get('r'))?.bubblesPerMinute).toBe(2);
    await repo.deleteCo2Reading('r');
    expect(await db.co2Readings.count()).toBe(0);
  });
});

describe('CareRepo', () => {
  const taskBase = { type: 'water_change' as const, label: 'Eau', everyDays: 7, nextDue: '2020-01-01', active: true };

  it('terminer une tâche récurrente reporte l’échéance de sa fréquence et journalise', async () => {
    const care = inject(CareRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await care.saveTask({ ...taskBase, id: 'k', tankId: t });
    await care.completeTask((await db.tasks.get('k'))!, 'ok', { waterChangedLiters: 20 });
    const task = (await db.tasks.get('k'))!;
    const today = new Date();
    const expected = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    expect(new Date(task.nextDue + 'T00:00').getTime()).toBe(expected.getTime());
    expect(task.active).toBe(true);
    const [log] = await db.logs.toArray();
    expect(log).toMatchObject({ taskId: 'k', label: 'Eau', note: 'ok', type: 'water_change', details: { waterChangedLiters: 20 } });
  });

  it('terminer une tâche unique la désactive', async () => {
    const care = inject(CareRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await care.saveTask({ ...taskBase, id: 'k', tankId: t, oneOff: true });
    await care.completeTask((await db.tasks.get('k'))!);
    expect((await db.tasks.get('k'))?.active).toBe(false);
  });

  it('un relevé ne valide pas une tâche pas encore due ni inactive', async () => {
    const care = inject(CareRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await care.saveTask({ ...taskBase, type: 'water_test', id: 'futur', tankId: t, nextDue: '2999-01-01' });
    await care.saveTask({ ...taskBase, type: 'water_test', id: 'off', tankId: t, active: false });
    await care.addWaterTest({ tankId: t, date: '2026-10-01T10:00:00Z', values: { ph: 7 } });
    expect(await db.logs.count()).toBe(0);
  });

  it('modifie et supprime un relevé', async () => {
    const care = inject(CareRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await care.addWaterTest({ id: 'w', tankId: t, date: '2026-10-01T10:00:00Z', values: { ph: 7 } });
    await care.updateWaterTest({ ...(await db.waterTests.get('w'))!, values: { ph: 6.5 } });
    expect((await db.waterTests.get('w'))?.values.ph).toBe(6.5);
    await care.deleteWaterTest('w');
    expect(await db.waterTests.count()).toBe(0);
  });

  it('supprime une tâche', async () => {
    const care = inject(CareRepo);
    await care.saveTask({ ...taskBase, id: 'k', tankId: 't' });
    await care.deleteTask('k');
    expect(await db.tasks.count()).toBe(0);
  });

  it('doses d’engrais : une ligne par produit, libellé avec la dose, ordre conservé', async () => {
    const care = inject(CareRepo);
    await care.logDoses('t', [{ product: 'NPK', amount: 2.5, unit: 'ml' }, { product: 'Fer' }, { product: 'Pompe', amount: 1, unit: 'pump', consumableId: 'c' }], undefined, 'matin');
    const logs = (await db.logs.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(logs.map((l) => l.label)).toEqual(['Engrais — NPK 2,5 ml', 'Engrais — Fer', 'Engrais — Pompe 1 pression(s)']);
    expect(logs.every((l) => l.type === 'fertilize' && l.note === 'matin' && l.tankId === 't')).toBe(true);
    expect(logs[2].details?.consumableId).toBe('c');
  });

  it('doses avec une tâche : la tâche est validée et les logs portent son identifiant', async () => {
    const care = inject(CareRepo);
    await care.saveTask({ ...taskBase, type: 'fertilize', id: 'k', tankId: 't' });
    await care.logDoses('t', [{ product: 'NPK', amount: 1 }], (await db.tasks.get('k'))!);
    const [log] = await db.logs.toArray();
    expect(log).toMatchObject({ taskId: 'k', type: 'fertilize' });
    expect((await db.tasks.get('k'))!.nextDue > '2026-01-01').toBe(true);
  });

  it('mode vacances : décale uniquement les tâches actives dues avant le retour', async () => {
    const care = inject(CareRepo);
    await care.saveTask({ ...taskBase, id: 'a', tankId: 't', nextDue: '2026-10-05' });
    await care.saveTask({ ...taskBase, id: 'b', tankId: 't', nextDue: '2026-10-20' });
    await care.saveTask({ ...taskBase, id: 'c', tankId: 't', nextDue: '2026-10-05', active: false });
    const moved = await care.postponeTasks('2026-10-10');
    expect(moved).toBe(1);
    expect((await db.tasks.get('a'))?.nextDue).toBe('2026-10-10');
    expect((await db.tasks.get('b'))?.nextDue).toBe('2026-10-20');
    expect((await db.tasks.get('c'))?.nextDue).toBe('2026-10-05');
  });

  it('un diagnostic ne crée de tâches que pour les actions cochées, avec les bons réglages', async () => {
    const care = inject(CareRepo);
    const id = await care.addDiagnosis(
      {
        tankId: 't', date: '2026-10-01T10:00:00Z', summary: 's', hypotheses: [],
        actions: [
          { title: 'A', priority: 'now', task: { type: 'plant_trim', label: 'Tailler', everyDays: 14, inDays: 2 } },
          { title: 'B', priority: 'soon', task: { type: 'custom', label: 'Ponctuel' } },
          { title: 'C', priority: 'later', task: { type: 'custom', label: 'Non coché' } },
          { title: 'D', priority: 'later' },
        ],
      },
      [true, true, false, true],
    );
    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(2);
    const a = tasks.find((t) => t.label === 'Tailler')!;
    expect(a).toMatchObject({ everyDays: 14, oneOff: false, diagnosisId: id, tankId: 't' });
    const b = tasks.find((t) => t.label === 'Ponctuel')!;
    expect(b).toMatchObject({ everyDays: 7, oneOff: true });
    const d = (await db.diagnoses.get(id))!;
    expect(d.actions.map((x) => x.taskId === undefined)).toEqual([false, false, true, true]);
  });

  it('coche une action, supprime un diagnostic', async () => {
    const care = inject(CareRepo);
    const id = await care.addDiagnosis({ tankId: 't', date: '2026-10-01T10:00:00Z', summary: 's', hypotheses: [], actions: [{ title: 'A', priority: 'now' }, { title: 'B', priority: 'now' }] }, []);
    await care.setActionDone((await db.diagnoses.get(id))!, 1, true);
    expect((await db.diagnoses.get(id))!.actions.map((a) => !!a.done)).toEqual([false, true]);
    await care.deleteDiagnosis(id);
    expect(await db.diagnoses.count()).toBe(0);
  });

  it('bilans visuels : ajout, résolution d’un constat, suppression', async () => {
    const care = inject(CareRepo);
    await care.addObservation({ id: 'o', tankId: 't', date: '2026-10-01T10:00:00Z', overall: 'watch', findings: [{ kind: 'algae', label: 'a' }, { kind: 'algae', label: 'b' }] });
    await care.setFindingResolved((await db.observations.get('o'))!, 0, true);
    expect((await db.observations.get('o'))!.findings.map((f) => !!(f as { resolved?: boolean }).resolved)).toEqual([true, false]);
    await care.deleteObservation('o');
    expect(await db.observations.count()).toBe(0);
  });
});

describe('PhotoRepo', () => {
  function stubImaging(width = 3000, height = 2000) {
    vi.stubGlobal('createImageBitmap', async () => ({ width, height, close: vi.fn() }));
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public w: number, public h: number) {}
      getContext() { return { drawImage: vi.fn() }; }
      async convertToBlob() { return new Blob([`${this.w}x${this.h}`], { type: 'image/jpeg' }); }
    });
  }
  const file = (name = 'a.jpg', type = 'image/jpeg', lastModified = Date.parse('2026-10-01T10:00:00Z')) => new File(['x'], name, { type, lastModified });

  it('réduit la photo (grand côté 1600, vignette 400) et la range à part', async () => {
    stubImaging();
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const [id] = await inject(PhotoRepo).addPhotos([file()], { tankId: t }, 'légende');
    const meta = (await db.photos.get(id))!;
    expect(meta).toMatchObject({ tankId: t, width: 3000, height: 2000, caption: 'légende', date: '2026-10-01T10:00:00.000Z' });
    const files = (await inject(PhotoRepo).photoFile(id))!;
    expect(await files.full.text()).toBe('1600x1067');
    expect(await files.thumb.text()).toBe('400x267');
  });

  it('la première photo d’un bac devient sa couverture, pas celle d’un habitant', async () => {
    stubImaging();
    const repo = inject(PhotoRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const [animal] = await repo.addPhotos([file()], { tankId: t, inhabitantId: 'i' });
    expect((await db.tanks.get(t))?.coverPhotoId).toBeUndefined();
    const [p1] = await repo.addPhotos([file(), file()], { tankId: t });
    expect((await db.tanks.get(t))?.coverPhotoId).toBe(p1);
    await repo.addPhotos([file()], { tankId: t });
    expect((await db.tanks.get(t))?.coverPhotoId).toBe(p1);
    expect(animal).not.toBe(p1);
  });

  it('utilise la date du jour quand celle du fichier est absente ou dans le futur', async () => {
    stubImaging(100, 50);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const repo = inject(PhotoRepo);
    const [a] = await repo.addPhotos([file('a.jpg', 'image/jpeg', 0)], { tankId: t });
    const [b] = await repo.addPhotos([file('b.jpg', 'image/jpeg', Date.now() + 86_400_000)], { tankId: t });
    for (const id of [a, b]) expect(Math.abs(Date.now() - new Date((await db.photos.get(id))!.date).getTime())).toBeLessThan(5000);
    expect(await (await repo.photoFile(a))!.full.text()).toBe('100x50');
  });

  it('refuse un fichier qui n’est pas une image ou illisible', async () => {
    stubImaging();
    const t = await inject(TankRepo).saveTank(tankData('A'));
    await expect(inject(PhotoRepo).addPhotos([file('a.txt', 'text/plain')], { tankId: t })).rejects.toThrow('pas une image');
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('x'); });
    await expect(inject(PhotoRepo).addPhotos([file()], { tankId: t })).rejects.toThrow('Format d’image');
    expect(await db.photos.count()).toBe(0);
  });

  it('légende, couverture et suppression avec bascule de couverture', async () => {
    stubImaging();
    const repo = inject(PhotoRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const [p1] = await repo.addPhotos([file('1.jpg', 'image/jpeg', Date.parse('2026-10-01T10:00:00Z'))], { tankId: t });
    const [p2] = await repo.addPhotos([file('2.jpg', 'image/jpeg', Date.parse('2026-10-02T10:00:00Z'))], { tankId: t });
    await repo.setCaption(p2, '  belle ');
    expect((await db.photos.get(p2))?.caption).toBe('belle');
    await repo.setCaption(p2, '   ');
    expect((await db.photos.get(p2))?.caption).toBeUndefined();
    await repo.setCover(t, p2);
    await repo.deletePhoto((await db.photos.get(p2))!);
    expect(await db.photoFiles.get(p2)).toBeUndefined();
    expect((await db.tanks.get(t))?.coverPhotoId).toBe(p1);
    await repo.deletePhoto((await db.photos.get(p1))!);
    expect((await db.tanks.get(t))?.coverPhotoId).toBeUndefined();
  });

  it('supprimer une photo qui n’est pas la couverture ne touche pas à la couverture', async () => {
    stubImaging();
    const repo = inject(PhotoRepo);
    const t = await inject(TankRepo).saveTank(tankData('A'));
    const [p1] = await repo.addPhotos([file()], { tankId: t });
    const [p2] = await repo.addPhotos([file()], { tankId: t });
    await repo.deletePhoto((await db.photos.get(p2))!);
    expect((await db.tanks.get(t))?.coverPhotoId).toBe(p1);
  });
});
