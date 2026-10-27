// Lecture des données : ordre des listes, mise à jour en direct et vues calculées de chaque bac.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFakeIndexedDb, waitFor } from './fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from './db';
import { BUILTIN_SPECIES } from './catalog';
import { PrefsRepo } from './data/prefs.repo';
import { AquariumStore } from './store';
import type { Inhabitant, Observation, Tank } from './models';

let db: AquariumDb;
let store: AquariumStore;
let n = 0;
const U = '';

beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb(`store-edge-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
  store = TestBed.inject(AquariumStore);
});
afterEach(async () => {
  TestBed.resetTestingModule();
  await db.delete();
});

const tank = (id: string, name: string, o: Partial<Tank> = {}): Tank => ({ id, updatedAt: U, name, type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false, ...o });
const inh = (id: string, tankId: string, speciesId: string, o: Partial<Inhabitant> = {}): Inhabitant => ({ id, updatedAt: U, tankId, speciesId, quantity: 10, unit: 'individual', addedDate: '2026-09-01', status: 'healthy', ...o });
const obs = (id: string, tankId: string, date: string, findings: Observation['findings'] = []): Observation => ({ id, updatedAt: U, tankId, date, overall: 'watch', findings });
const finding = (severity: 'info' | 'warn' | 'danger', extra = {}) => ({ category: 'algae', severity, title: 'Algues', ...extra }) as never;
const ready = () => waitFor(() => store.ready());

describe('chargement', () => {
  it('est prêt une fois le catalogue intégré chargé', async () => {
    expect(store.ready()).toBe(false);
    await ready();
    await waitFor(() => store.species().length === BUILTIN_SPECIES.length);
    expect(store.speciesById().get('danio-margaritatus')?.scientificName).toBe('Danio margaritatus');
  });

  it('commence vide et se met à jour dès qu’une donnée est ajoutée', async () => {
    expect(store.tanks()).toEqual([]);
    expect(store.photos()).toEqual([]);
    await db.tanks.put(tank('a', 'Salon'));
    await waitFor(() => store.tanks().length === 1);
    expect(store.tanks()[0].name).toBe('Salon');
  });
});

describe('ordre des listes', () => {
  it('trie chaque liste dans le bon sens', async () => {
    await ready();
    await db.inhabitantEvents.bulkPut([
      { id: 'e2', updatedAt: U, inhabitantId: 'i', tankId: 'a', date: '2026-10-02', type: 'note' },
      { id: 'e3', updatedAt: U, inhabitantId: 'i', tankId: 'a', date: '2026-10-03', type: 'note' },
      { id: 'e1', updatedAt: U, inhabitantId: 'i', tankId: 'a', date: '2026-10-01', type: 'note' },
    ]);
    await db.waterTests.bulkPut([
      { id: 'w2', updatedAt: U, tankId: 'a', date: '2026-10-02', values: {} },
      { id: 'w3', updatedAt: U, tankId: 'a', date: '2026-10-03', values: {} },
      { id: 'w1', updatedAt: U, tankId: 'a', date: '2026-10-01', values: {} },
    ]);
    await db.tasks.bulkPut([
      { id: 't2', updatedAt: U, tankId: 'a', type: 'custom', label: '2', everyDays: 7, nextDue: '2026-10-20', active: true },
      { id: 't1', updatedAt: U, tankId: 'a', type: 'custom', label: '1', everyDays: 7, nextDue: '2026-10-10', active: true },
      { id: 't3', updatedAt: U, tankId: 'a', type: 'custom', label: '3', everyDays: 7, nextDue: '2026-10-30', active: true },
    ]);
    await db.logs.bulkPut([
      { id: 'l2', updatedAt: U, tankId: 'a', type: 'custom', label: '2', date: '2026-10-02' },
      { id: 'l3', updatedAt: U, tankId: 'a', type: 'custom', label: '3', date: '2026-10-03' },
      { id: 'l1', updatedAt: U, tankId: 'a', type: 'custom', label: '1', date: '2026-10-01' },
    ]);
    await db.observations.bulkPut([obs('o2', 'a', '2026-10-02'), obs('o3', 'a', '2026-10-03'), obs('o1', 'a', '2026-10-01')]);
    await db.photos.bulkPut(['p2', 'p3', 'p1'].map((id) => ({ id, updatedAt: U, tankId: 'a', date: `2026-10-0${id[1]}`, width: 1, height: 1 })));
    await db.co2Readings.bulkPut(['r2', 'r3', 'r1'].map((id) => ({ id, updatedAt: U, tankId: 'a', date: `2026-10-0${id[1]}` })));
    await db.diagnoses.bulkPut(['g2', 'g3', 'g1'].map((id) => ({ id, updatedAt: U, tankId: 'a', date: `2026-10-0${id[1]}`, summary: '', hypotheses: [], actions: [] })));
    await db.settingChanges.bulkPut(['s2', 's3', 's1'].map((id) => ({ id, updatedAt: U, tankId: 'a', equipmentId: 'e', equipmentName: 'E', date: `2026-10-0${id[1]}`, field: 'light.intensityPct' as const })));
    await waitFor(() => [store.inhabitantEvents(), store.waterTests(), store.tasks(), store.logs(), store.observations(), store.photos(), store.co2Readings(), store.diagnoses(), store.settingChanges()].every((l) => l.length === 3));

    const ids = (l: { id: string }[]) => l.map((x) => x.id);
    expect(ids(store.inhabitantEvents())).toEqual(['e3', 'e2', 'e1']);
    expect(ids(store.waterTests())).toEqual(['w1', 'w2', 'w3']);
    expect(ids(store.tasks())).toEqual(['t1', 't2', 't3']);
    expect(ids(store.logs())).toEqual(['l3', 'l2', 'l1']);
    expect(ids(store.observations())).toEqual(['o1', 'o2', 'o3']);
    expect(ids(store.photos())).toEqual(['p3', 'p2', 'p1']);
    expect(ids(store.co2Readings())).toEqual(['r1', 'r2', 'r3']);
    expect(ids(store.diagnoses())).toEqual(['g1', 'g2', 'g3']);
    expect(ids(store.settingChanges())).toEqual(['s1', 's2', 's3']);
  });

  it('lit aussi les listes sans tri particulier', async () => {
    await ready();
    await db.inhabitants.put(inh('i', 'a', 'danio-margaritatus'));
    await db.equipment.put({ id: 'e', updatedAt: U, type: 'filter', name: 'F' });
    await db.consumables.put({ id: 'c', updatedAt: U, name: 'N', category: 'food', level: 'full' });
    await waitFor(() => store.inhabitants().length === 1 && store.equipment().length === 1 && store.consumables().length === 1);
    expect(store.equipment()[0].name).toBe('F');
    expect(store.consumables()[0].name).toBe('N');
  });
});

describe('photos d’habitants', () => {
  it('retient la plus récente de chaque habitant, pas les photos de bac', async () => {
    await ready();
    const photo = (id: string, date: string, inhabitantId?: string) => ({ id, updatedAt: U, tankId: 'a', inhabitantId, date, width: 1, height: 1 });
    await db.photos.bulkPut([photo('old', '2026-10-01', 'i1'), photo('new', '2026-10-05', 'i1'), photo('other', '2026-10-03', 'i2'), photo('tank', '2026-10-09')]);
    await waitFor(() => store.photos().length === 4);
    expect([...store.inhabitantCovers()]).toEqual([['i1', 'new'], ['i2', 'other']]);
  });
});

describe('catalogue', () => {
  it('masque la fiche intégrée remplacée par une fiche personnalisée', async () => {
    await ready();
    await waitFor(() => store.species().length === BUILTIN_SPECIES.length);
    await db.species.put({ id: 'custom-1', source: 'custom', overrides: 'danio-margaritatus', scientificName: 'Danio margaritatus', commonNames: ['Perso'], kind: 'fish', updatedAt: U } as never);
    await waitFor(() => store.species().length === BUILTIN_SPECIES.length + 1);
    const ids = store.catalog().map((s) => s.id);
    expect(ids).toContain('custom-1');
    expect(ids).not.toContain('danio-margaritatus');
    expect(ids).toHaveLength(BUILTIN_SPECIES.length);
  });
});

describe('bacs actifs', () => {
  it('écarte les bacs archivés et trie par nom à la française', async () => {
    await db.tanks.bulkPut([tank('1', 'Salon'), tank('2', 'Nano'), tank('3', 'Éco'), tank('4', 'Vieux', { archived: true })]);
    await waitFor(() => store.tanks().length === 4);
    expect(store.activeTanks().map((t) => t.name)).toEqual(['Éco', 'Nano', 'Salon']);
    expect(store.tanks()).toHaveLength(4);
  });
});

describe('vue d’un bac', () => {
  const view = (id: string) => store.tankViews().find((v) => v.tank.id === id)!;

  async function load() {
    await ready();
    await waitFor(() => store.species().length === BUILTIN_SPECIES.length);
  }

  it('range les habitants vivants par nom scientifique, plantes et animaux séparés', async () => {
    await db.tanks.put(tank('a', 'Salon'));
    await db.inhabitants.bulkPut([
      inh('1', 'a', 'rotala-rotundifolia', { unit: 'stem' }),
      inh('2', 'a', 'neocaridina-davidi'),
      inh('3', 'a', 'danio-margaritatus'),
      inh('4', 'a', 'danio-margaritatus', { status: 'dead' }),
      inh('5', 'a', 'danio-margaritatus', { status: 'removed' }),
      inh('6', 'a', 'espece-inconnue'),
      inh('7', 'b', 'danio-margaritatus'),
    ]);
    await load();
    await waitFor(() => store.inhabitants().length === 7 && store.tankViews().length === 1);
    const v = view('a');
    expect(v.members.map((m) => m.inhabitant.id)).toEqual(['3', '2', '1']);
    expect(v.plants.map((m) => m.inhabitant.id)).toEqual(['1']);
    expect(v.fauna.map((m) => m.inhabitant.id)).toEqual(['3', '2']);
    expect(v.members[0].species.scientificName).toBe('Danio margaritatus');
  });

  it('un bac sans rien est « OK », sans relevé ni alerte', async () => {
    await db.tanks.put(tank('a', 'Salon'));
    await load();
    await waitFor(() => store.tankViews().length === 1);
    const v = view('a');
    expect(v).toMatchObject({ level: 'ok', statusLabel: 'OK', alerts: [], issues: [], tests: [], members: [], openFindings: [], tasks: [] });
    expect(v.lastTest).toBeUndefined();
    expect(v.lastObservation).toBeUndefined();
  });

  it('garde les relevés du bac, du plus ancien au plus récent, et juge le dernier', async () => {
    await db.tanks.bulkPut([tank('a', 'Salon'), tank('b', 'Nano')]);
    await db.waterTests.bulkPut([
      { id: 'w2', updatedAt: U, tankId: 'a', date: '2026-10-03', values: { no3: 50 } },
      { id: 'w1', updatedAt: U, tankId: 'a', date: '2026-10-01', values: { no3: 10 } },
      { id: 'wb', updatedAt: U, tankId: 'b', date: '2026-10-05', values: { no3: 10 } },
    ]);
    await load();
    await waitFor(() => store.waterTests().length === 3 && store.tankViews().length === 2);
    const a = view('a');
    expect(a.tests.map((t) => t.id)).toEqual(['w1', 'w2']);
    expect(a.lastTest?.id).toBe('w2');
    expect(a.alerts.map((x) => x.key)).toEqual(['no3']);
    expect(a.statusLabel).toBe('NO3 élevé');
    expect(a.level).toBe('danger');
    expect(view('b')).toMatchObject({ statusLabel: 'OK', level: 'ok' });
  });

  it('une valeur trop basse donne « bas »', async () => {
    await db.tanks.put(tank('a', 'Salon'));
    await db.waterTests.put({ id: 'w', updatedAt: U, tankId: 'a', date: '2026-10-03', values: { temp: 15 } });
    await load();
    await waitFor(() => store.tankViews()[0]?.lastTest !== undefined);
    expect(view('a').statusLabel).toBe('Temp. bas');
    expect(view('a').alerts[0].direction).toBe('low');
  });

  it('juge les alertes avec les plages des espèces du bac', async () => {
    await db.tanks.put(tank('a', 'Salon'));
    await db.inhabitants.put(inh('1', 'a', 'danio-margaritatus'));
    await db.waterTests.put({ id: 'w', updatedAt: U, tankId: 'a', date: '2026-10-03', values: { temp: 21 } });
    await load();
    await waitFor(() => store.tankViews()[0]?.members.length === 1 && store.tankViews()[0].lastTest !== undefined);
    // 21 °C est trop frais pour la plage par défaut (22–26) mais convient aux danios (20–26).
    expect(view('a').alerts).toEqual([]);
  });

  it('remonte les problèmes de cohabitation', async () => {
    await db.tanks.put(tank('a', 'Salon'));
    await db.inhabitants.put(inh('1', 'a', 'danio-margaritatus', { quantity: 2 }));
    await load();
    await waitFor(() => store.tankViews()[0]?.members.length === 1);
    expect(view('a').issues.map((i) => i.title)).toContain('Groupe trop petit : Rasbora galaxy');
  });

  describe('bilan visuel', () => {
    it('un constat ouvert à surveiller fait passer le bac en « Bilan visuel »', async () => {
      await db.tanks.put(tank('a', 'Salon'));
      await db.observations.bulkPut([obs('o1', 'a', '2026-10-01', [finding('danger')]), obs('o2', 'a', '2026-10-05', [finding('warn')])]);
      await load();
      await waitFor(() => store.tankViews()[0]?.lastObservation?.id === 'o2');
      const v = view('a');
      expect(v.statusLabel).toBe('Bilan visuel');
      expect(v.level).toBe('warn');
      expect(v.openFindings).toHaveLength(1);
    });

    it('un constat dangereux met le bac en danger', async () => {
      await db.tanks.put(tank('a', 'Salon'));
      await db.observations.put(obs('o', 'a', '2026-10-01', [finding('danger')]));
      await load();
      await waitFor(() => store.tankViews()[0]?.lastObservation !== undefined);
      expect(view('a')).toMatchObject({ level: 'danger', statusLabel: 'Bilan visuel' });
    });

    it('ignore les constats résolus et informatifs', async () => {
      await db.tanks.put(tank('a', 'Salon'));
      await db.observations.put(obs('o', 'a', '2026-10-01', [finding('danger', { resolved: true }), finding('info')]));
      await load();
      await waitFor(() => store.tankViews()[0]?.lastObservation !== undefined);
      expect(view('a')).toMatchObject({ level: 'ok', statusLabel: 'OK', openFindings: [] });
    });

    it('une alerte d’eau passe avant le bilan visuel dans l’étiquette', async () => {
      await db.tanks.put(tank('a', 'Salon'));
      await db.observations.put(obs('o', 'a', '2026-10-01', [finding('warn')]));
      await db.waterTests.put({ id: 'w', updatedAt: U, tankId: 'a', date: '2026-10-03', values: { no3: 30 } });
      await load();
      await waitFor(() => store.tankViews()[0]?.lastTest !== undefined && store.tankViews()[0].lastObservation !== undefined);
      expect(view('a').statusLabel).toBe('NO3 élevé');
      expect(view('a').level).toBe('warn');
    });
  });

  it('ne garde que les tâches actives du bac', async () => {
    await db.tanks.put(tank('a', 'Salon'));
    const t = (id: string, o = {}) => ({ id, updatedAt: U, tankId: 'a', type: 'custom' as const, label: id, everyDays: 7, nextDue: '2026-10-01', active: true, ...o });
    await db.tasks.bulkPut([t('on'), t('off', { active: false }), t('autre', { tankId: 'b' })]);
    await load();
    await waitFor(() => store.tasks().length === 3 && store.tankViews().length === 1);
    expect(view('a').tasks.map((x) => x.id)).toEqual(['on']);
  });

  it('n’inclut pas les bacs archivés', async () => {
    await db.tanks.bulkPut([tank('a', 'Salon'), tank('z', 'Vieux', { archived: true })]);
    await load();
    await waitFor(() => store.tanks().length === 2);
    expect(store.tankViews().map((v) => v.tank.id)).toEqual(['a']);
  });
});

describe('tâches dues', () => {
  const task = (id: string, nextDue: string, o = {}) => ({ id, updatedAt: U, tankId: 'a', type: 'custom' as const, label: id, everyDays: 7, nextDue, active: true, ...o });

  it('liste les tâches actives échues, des plus en retard aux plus récentes, avec leur bac', async () => {
    await ready();
    const today = store.today();
    await db.tanks.bulkPut([tank('a', 'Salon'), tank('z', 'Vieux', { archived: true })]);
    await db.tasks.bulkPut([
      task('aujourdhui', today),
      task('retard', '2000-01-01'),
      task('demain', '2999-01-01'),
      task('inactive', '2000-01-01', { active: false }),
      task('archive', '2000-01-01', { tankId: 'z' }),
      task('inconnu', '2000-01-01', { tankId: 'x' }),
    ]);
    await waitFor(() => store.tasks().length === 6 && store.tanks().length === 2);
    expect(store.dueTasks().map((d) => d.task.id)).toEqual(['retard', 'aujourdhui']);
    expect(store.dueTasks()[0].tank.name).toBe('Salon');
  });
});

describe('préférences de rappel', () => {
  it('part des valeurs par défaut puis suit ce qui est enregistré', async () => {
    expect(store.notificationPrefs()).toMatchObject({ enabled: false, time: '09:00', tasks: true, followUps: true });
    await TestBed.inject(PrefsRepo).saveNotificationPrefs({ enabled: true, time: '07:30' });
    await waitFor(() => store.notificationPrefs().enabled);
    expect(store.notificationPrefs()).toMatchObject({ enabled: true, time: '07:30', tasks: true });
  });
});
