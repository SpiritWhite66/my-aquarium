// Le dossier envoyé à l'IA : chaque section est vérifiée, avec des données de deux bacs pour s'assurer
// que rien d'un autre bac n'y entre.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDossier, diagnosticRequest, photoFileName, type DossierInput } from './diagnostic';
import type { Diagnosis, Equipment, Inhabitant, MaintenanceLog, Species, Tank, WaterTest } from './models';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

const U = '';
const tank: Tank = { id: 'a', updatedAt: U, name: 'Salon', type: 'planted', volumeGross: 60, volumeNet: 50, startDate: '2026-09-01', co2: true, co2Target: 2, archived: false, substrate: 'Sable', notes: 'Bac de test' };
const sp = (id: string, o: Record<string, unknown> = {}): Species => ({ id, scientificName: `Sci ${id}`, commonNames: [id.toUpperCase()], kind: 'fish', source: 'builtin', ...o }) as unknown as Species;
const danio = sp('danio', { temp: { min: 22, max: 26 }, ph: { min: 6.5, max: 7.5 }, fauna: { minGroup: 6 } });
const rotala = sp('rotala', { kind: 'plant', flora: { co2: 'required' } });
const inh = (id: string, speciesId: string, o: Partial<Inhabitant> = {}): Inhabitant => ({ id, updatedAt: U, tankId: 'a', speciesId, quantity: 12, unit: 'individual', addedDate: '2026-09-02', status: 'healthy', ...o });
const test = (id: string, date: string, values: WaterTest['values'], o: Partial<WaterTest> = {}): WaterTest => ({ id, updatedAt: U, tankId: 'a', date, values, ...o });
const log = (id: string, date: string, o: Partial<MaintenanceLog> = {}): MaintenanceLog => ({ id, updatedAt: U, tankId: 'a', type: 'water_change', label: 'Eau', date, ...o });

function input(o: Partial<DossierInput> = {}): DossierInput {
  return {
    tank, species: [danio, rotala], inhabitants: [], events: [], tests: [], tasks: [], logs: [], equipment: [], co2Readings: [], observations: [], diagnoses: [], photos: [], today: '2026-10-27', ...o,
  };
}

describe('en-tête et bac', () => {
  it('décrit le format, le bac et la question posée', () => {
    const d = buildDossier(input({ question: '  Algues vertes  ' }));
    expect(d).toMatchObject({ format: 'my-aquarium-dossier', version: 1, generatedAt: '2026-10-27T12:00:00.000Z', question: 'Algues vertes' });
    expect(d.tank).toEqual({ name: 'Salon', type: 'planted', volumeL: 50, ageDays: 56, substrate: 'Sable', co2Injection: true, co2TargetBpm: 2, cycling: false, notes: 'Bac de test' });
    expect(d.stats).toEqual({ volumeL: 50 });
  });

  it('une question vide n’est pas transmise ; le volume brut sert sans volume net', () => {
    expect(buildDossier(input({ question: '   ' })).question).toBeUndefined();
    expect(buildDossier(input()).question).toBeUndefined();
    const d = buildDossier(input({ tank: { ...tank, volumeNet: undefined, cycling: true } }));
    expect(d.tank.volumeL).toBe(60);
    expect(d.tank.cycling).toBe(true);
  });
});

describe('population', () => {
  const inhabitants = [
    inh('i1', 'danio', { approximate: true, status: 'sick' }),
    inh('i2', 'rotala', { quantity: 8, unit: 'stem', approximate: false }),
    inh('i3', 'danio', { status: 'dead' }),
    inh('i4', 'danio', { status: 'removed' }),
    inh('i5', 'danio', { tankId: 'b' }),
    inh('i6', 'inconnue'),
  ];

  it('ne garde que les habitants vivants du bac dont la fiche est connue', () => {
    const d = buildDossier(input({ inhabitants }));
    expect(d.population.map((p) => p.name)).toEqual(['DANIO', 'ROTALA']);
    expect(d.population[0]).toMatchObject({ scientificName: 'Sci danio', kind: 'fish', quantity: 12, approximate: true, unit: 'individual', status: 'sick', since: '2026-09-02' });
    expect(d.population[0].ranges).toEqual({ temp: { min: 22, max: 26 }, ph: { min: 6.5, max: 7.5 }, gh: undefined, kh: undefined });
    expect(d.population[0].fauna).toEqual({ minGroup: 6 });
    expect(d.population[1].approximate).toBeUndefined();
    expect(d.population[1].flora).toEqual({ co2: 'required' });
  });

  it('signale les problèmes de cohabitation du bac', () => {
    const d = buildDossier(input({ inhabitants: [inh('i1', 'danio', { quantity: 3 })], tank: { ...tank, co2: false } }));
    expect(d.compatibilityIssues).toEqual(['Groupe trop petit : DANIO : 3 individus, au moins 6 conseillés.']);
    expect(buildDossier(input({ inhabitants: [inh('i1', 'danio')] })).compatibilityIssues).toEqual([]);
  });
});

describe('événements récents', () => {
  it('garde 20 événements du bac, avec l’espèce concernée', () => {
    const events = [
      ...Array.from({ length: 25 }, (_, n) => ({ id: `e${n}`, updatedAt: U, inhabitantId: 'i1', tankId: 'a', date: '2026-10-20T10:00:00Z', type: 'note' as const, note: `n${n}` })),
      { id: 'x', updatedAt: U, inhabitantId: 'i9', tankId: 'b', date: '2026-10-20T10:00:00Z', type: 'death' as const },
    ];
    const d = buildDossier(input({ events, inhabitants: [inh('i1', 'danio')] }));
    expect(d.recentEvents).toHaveLength(20);
    expect(d.recentEvents[0]).toEqual({ date: '2026-10-20', type: 'note', quantityDelta: undefined, note: 'n0', species: 'Sci danio' });
    expect(d.recentEvents.at(-1)!.note).toBe('n19');
  });

  it('une espèce introuvable donne un événement sans nom d’espèce', () => {
    const d = buildDossier(input({ events: [{ id: 'e', updatedAt: U, inhabitantId: 'zzz', tankId: 'a', date: '2026-10-20T10:00:00Z', type: 'death', quantityDelta: -1 }] }));
    expect(d.recentEvents[0]).toMatchObject({ type: 'death', quantityDelta: -1, species: undefined });
  });
});

describe('eau', () => {
  const tests = [
    test('t3', '2026-10-25T10:00:00Z', { no3: 40, ph: 6.8, kh: 4 }),
    test('t1', '2026-10-05T10:00:00Z', { no3: 10, ph: 7, kh: 4 }, { method: 'drops', note: 'début' }),
    test('t2', '2026-10-15T10:00:00Z', { no3: 25, ph: 6.9, kh: 4, fe: 0.2 }),
    test('tb', '2026-10-25T10:00:00Z', { no3: 999 }, { tankId: 'b' }),
  ];

  it('trie les relevés du bac par date et décrit les paramètres mesurés avec leurs unités', () => {
    const d = buildDossier(input({ tests, inhabitants: [inh('i1', 'danio')] }));
    expect(d.water.tests.map((t) => t.date)).toEqual(['2026-10-05T10:00:00Z', '2026-10-15T10:00:00Z', '2026-10-25T10:00:00Z']);
    expect(d.water.tests[0]).toEqual({ date: '2026-10-05T10:00:00Z', values: { no3: 10, ph: 7, kh: 4 }, method: 'drops', note: 'début' });
    expect(d.water.measured).toEqual(['temp', 'ph', 'gh', 'kh', 'no2', 'no3', 'nh4', 'po4', 'fe']);
    expect(d.water.units).toMatchObject({ temp: '°C', ph: '', no3: 'mg/L', fe: 'mg/L' });
  });

  it('ne garde que les 15 derniers relevés', () => {
    const many = Array.from({ length: 20 }, (_, n) => test(`m${n}`, `2026-10-${String(n + 1).padStart(2, '0')}T10:00:00Z`, { ph: 7 }));
    const d = buildDossier(input({ tests: many }));
    expect(d.water.tests).toHaveLength(15);
    expect(d.water.tests[0].date).toBe('2026-10-06T10:00:00Z');
  });

  it('donne les plages idéales, en précisant si elles viennent des espèces', () => {
    const d = buildDossier(input({ tests, inhabitants: [inh('i1', 'danio')] }));
    expect(d.water.idealRanges['ph']).toEqual({ min: 6.5, max: 7.5, fromSpecies: true, conflict: undefined });
    expect(d.water.idealRanges['no3']).toEqual({ min: 5, max: 25, fromSpecies: false, conflict: undefined });
    expect(d.water.idealRanges['fe']).toEqual({ min: 0.05, max: 0.5, fromSpecies: false, conflict: undefined });
  });

  it('signale un conflit de plages', () => {
    const cold = sp('cold', { temp: { min: 10, max: 15 } });
    const d = buildDossier(input({ species: [danio, cold], inhabitants: [inh('i1', 'danio'), inh('i2', 'cold')], tests }));
    expect(d.water.idealRanges['temp']).toMatchObject({ conflict: true, fromSpecies: true });
  });

  it('liste les valeurs hors plage du dernier relevé uniquement', () => {
    const d = buildDossier(input({ tests, inhabitants: [inh('i1', 'danio')] }));
    expect(d.water.outOfRange).toEqual([{ param: 'no3', value: 40, level: 'danger' }]);
  });

  it('donne les tendances nettes avec leur échéance', () => {
    const d = buildDossier(input({ tests, inhabitants: [inh('i1', 'danio')] }));
    expect(d.water.trends['no3']).toEqual({ perWeek: 10.5, daysToLimit: undefined, limit: undefined });
    const rising = [test('a', '2026-10-05T10:00:00Z', { no3: 10 }), test('b', '2026-10-15T10:00:00Z', { no3: 15 }), test('c', '2026-10-25T10:00:00Z', { no3: 20 })];
    expect(buildDossier(input({ tests: rising })).water.trends['no3']).toEqual({ perWeek: 3.5, daysToLimit: 10, limit: 'max' });
  });

  it('sans relevé, rien à signaler', () => {
    const d = buildDossier(input());
    expect(d.water.tests).toEqual([]);
    expect(d.water.outOfRange).toEqual([]);
    expect(d.water.trends).toEqual({});
  });
});

describe('CO2', () => {
  const tests = [test('t', '2026-10-25T10:00:00Z', { kh: 4, ph: 7 })];
  const reading = (n: number, o = {}) => ({ id: `r${n}`, updatedAt: U, tankId: 'a', date: `2026-10-${String(n).padStart(2, '0')}T10:00:00Z`, ...o });

  it('est absent d’un bac sans injection', () => {
    expect(buildDossier(input({ tank: { ...tank, co2: false } })).co2).toBeUndefined();
  });

  it('estime le CO2 d’après le KH et le pH', () => {
    const d = buildDossier(input({ tests }));
    expect(d.co2?.estimatedMgL).toBe(12);
    expect(d.co2?.estimatedFrom).toEqual({ kh: 4, ph: 7, date: '2026-10-25T10:00:00Z' });
    expect(buildDossier(input()).co2?.estimatedMgL).toBeUndefined();
  });

  it('résume les 8 dernières mesures de bulles ou de drop checker, sans les mesures vides', () => {
    const readings = [
      ...Array.from({ length: 10 }, (_, n) => reading(n + 1, { bubblesPerMinute: 2 + n })),
      reading(20, { dropChecker: 'green' }),
      reading(21, { note: 'vide' }),
      { ...reading(22, { bubblesPerMinute: 99 }), tankId: 'b' },
    ];
    const d = buildDossier(input({ co2Readings: readings }));
    expect(d.co2!.readings).toEqual([
      { date: '2026-10-05T10:00:00Z', bpm: 6, dropChecker: undefined },
      { date: '2026-10-06T10:00:00Z', bpm: 7, dropChecker: undefined },
      { date: '2026-10-07T10:00:00Z', bpm: 8, dropChecker: undefined },
      { date: '2026-10-08T10:00:00Z', bpm: 9, dropChecker: undefined },
      { date: '2026-10-09T10:00:00Z', bpm: 10, dropChecker: undefined },
      { date: '2026-10-10T10:00:00Z', bpm: 11, dropChecker: undefined },
      { date: '2026-10-20T10:00:00Z', bpm: undefined, dropChecker: 'green' },
    ]);
  });

  it('résume les 5 dernières mesures de baisse de pH avec le CO2 déduit', () => {
    const readings = Array.from({ length: 7 }, (_, n) => reading(n + 1, { phBefore: 7.4, phAfter: 6.6, phBeforeTime: '09:00', phAfterTime: '17:00' }));
    readings.push(reading(8, { phBefore: 7 }) as never);
    const d = buildDossier(input({ co2Readings: readings }));
    expect(d.co2!.phDrop).toHaveLength(5);
    expect(d.co2!.phDrop[0]).toEqual({ date: '2026-10-03', phBefore: 7.4, phBeforeTime: '09:00', phAfter: 6.6, phAfterTime: '17:00', drop: 0.8, mgL: 18.9 });
  });
});

describe('matériel', () => {
  const gear: Equipment[] = [
    { id: 'e1', updatedAt: U, tankId: 'a', type: 'light', name: 'Rampe', brand: 'Chihiros', model: 'WRGB', specs: '120 cm', purchaseDate: '2026-01-01', light: { schedule: { on: '10:00', off: '20:00' }, siesta: { on: '13:00', off: '15:00' } } },
    { id: 'e2', updatedAt: U, tankId: 'a', type: 'filter', name: 'Filtre', filter: { flowLh: 600 } },
    { id: 'e3', updatedAt: U, tankId: 'b', type: 'heater', name: 'Autre bac' },
  ];

  it('décrit le matériel du bac avec la durée d’éclairage', () => {
    const d = buildDossier(input({ equipment: gear }));
    expect(d.equipment).toHaveLength(2);
    expect(d.equipment[0]).toMatchObject({ type: 'light', name: 'Rampe', brand: 'Chihiros', model: 'WRGB', specs: '120 cm', purchaseDate: '2026-01-01' });
    expect(d.equipment[0].light).toMatchObject({ photoperiodHours: 8 });
    expect(d.equipment[1].light).toBeUndefined();
    expect(d.equipment[1].filter).toEqual({ flowLh: 600 });
  });

  it('ne rapporte que les contrôles qui ne sont pas « ok »', () => {
    const long = [{ ...gear[0], light: { schedule: { on: '08:00', off: '20:00' } } }, gear[1]] as Equipment[];
    const d = buildDossier(input({ equipment: long }));
    expect(d.equipmentChecks).toEqual(['Éclairage long : 12 h par jour']);
    expect(buildDossier(input({ equipment: [gear[1]] })).equipmentChecks).toEqual([]);
  });
});

describe('entretien', () => {
  it('liste les tâches régulières actives du bac, pas les ponctuelles', () => {
    const task = (id: string, o = {}) => ({ id, updatedAt: U, tankId: 'a', type: 'water_change' as const, label: id, everyDays: 7, nextDue: '2026-10-30', active: true, ...o });
    const d = buildDossier(input({ tasks: [task('t1'), task('t2', { active: false }), task('t3', { oneOff: true }), task('t4', { tankId: 'b' })] }));
    expect(d.maintenance.routine).toEqual([{ label: 't1', type: 'water_change', everyDays: 7, nextDue: '2026-10-30' }]);
  });

  it('résume les 25 premières entrées du journal du bac', () => {
    const logs = [
      ...Array.from({ length: 30 }, (_, n) => log(`l${n}`, '2026-10-20T10:00:00Z', { label: `L${n}`, note: 'n', details: n === 0 ? { waterChangedLiters: 20 } : undefined })),
      log('x', '2026-10-20T10:00:00Z', { tankId: 'b' }),
    ];
    const d = buildDossier(input({ logs }));
    expect(d.maintenance.recent).toHaveLength(25);
    expect(d.maintenance.recent[0]).toEqual({ date: '2026-10-20', type: 'water_change', label: 'L0', note: 'n', waterChangedL: 20 });
    expect(d.maintenance.recent[1].waterChangedL).toBeUndefined();
  });
});

describe('bilans visuels', () => {
  const obs = (n: number, o = {}) => ({ id: `o${n}`, updatedAt: U, tankId: 'a', date: `2026-10-${String(n).padStart(2, '0')}T10:00:00Z`, overall: 'watch' as const, findings: [], ...o });

  it('garde les 8 derniers bilans du bac', () => {
    const list = [...Array.from({ length: 10 }, (_, n) => obs(n + 1)), obs(15, { tankId: 'b' })];
    const d = buildDossier(input({ observations: list }));
    expect(d.visualChecks).toHaveLength(8);
    expect(d.visualChecks[0].date).toBe('2026-10-03');
  });

  it('résume un bilan manuel et ses constats', () => {
    const d = buildDossier(input({
      observations: [
        obs(1, { manual: true, algaeLevel: 2, algaeTypes: ['filaments'], summary: 'Algues', findings: [{ category: 'algae', severity: 'warn', title: 'Filaments', resolved: true }, { category: 'plants', severity: 'info', title: 'Ok' }] }),
        obs(2),
      ],
    }));
    expect(d.visualChecks[0]).toEqual({
      date: '2026-10-01', manual: true, algaeLevel: 2, algaeTypes: ['filaments'], overall: 'watch', summary: 'Algues',
      findings: [{ category: 'algae', severity: 'warn', title: 'Filaments', resolved: true }, { category: 'plants', severity: 'info', title: 'Ok', resolved: undefined }],
    });
    expect(d.visualChecks[1].manual).toBeUndefined();
  });
});

describe('fertilisation', () => {
  it('liste les engrais en stock et les doses des 30 derniers jours', () => {
    const consumables = [
      { id: 'c1', updatedAt: U, name: 'NPK', brand: 'Marque', category: 'fertilizer' as const, level: 'half' as const },
      { id: 'c2', updatedAt: U, name: 'Granulés', category: 'food' as const, level: 'full' as const },
    ];
    const logs = [
      log('d1', '2026-10-27T08:00:00Z', { type: 'fertilize', label: 'Engrais — NPK 2 ml', details: { product: 'NPK', amount: 2, unit: 'ml' } }),
      log('d2', '2026-09-27T08:00:00Z', { type: 'fertilize', label: 'Engrais — Fer' }),
      log('d3', '2026-09-26T08:00:00Z', { type: 'fertilize', label: 'Trop ancien' }),
      log('d4', '2026-10-26T08:00:00Z', { type: 'water_change' }),
      log('d5', '2026-10-26T08:00:00Z', { type: 'fertilize', tankId: 'b' }),
    ];
    const d = buildDossier(input({ consumables, logs }));
    expect(d.fertilization.productsInStock).toEqual([{ name: 'NPK', brand: 'Marque', level: 'half' }]);
    expect(d.fertilization.doses).toEqual([
      { date: '2026-10-27', product: 'NPK', amount: 2, unit: 'ml' },
      { date: '2026-09-27', product: 'Engrais — Fer', amount: undefined, unit: undefined },
    ]);
    expect(buildDossier(input()).fertilization).toEqual({ productsInStock: [], doses: [] });
  });
});

describe('historique des réglages', () => {
  it('garde les 15 derniers changements du bac', () => {
    const change = (n: number, tankId = 'a') => ({ id: `c${n}`, updatedAt: U, tankId, equipmentId: 'e', equipmentName: 'Rampe', date: '2026-10-20T10:00:00Z', field: 'light.intensityPct' as const, from: n - 1, to: n, note: `raison ${n}` });
    const d = buildDossier(input({ settingChanges: [...Array.from({ length: 17 }, (_, n) => change(n + 1)), change(99, 'b')] as never }));
    expect(d.settingsHistory).toHaveLength(15);
    expect(d.settingsHistory[0]).toEqual({ date: '2026-10-20', equipment: 'Rampe', setting: 'light.intensityPct', from: 2, to: 3, reason: 'raison 3' });
    expect(buildDossier(input()).settingsHistory).toEqual([]);
  });
});

describe('suivi et diagnostics précédents', () => {
  const diag = (n: number, o: Partial<Diagnosis> = {}): Diagnosis => ({
    id: `g${n}`, updatedAt: U, tankId: 'a', date: `2026-10-${String(n).padStart(2, '0')}T10:00:00Z`, summary: `Résumé ${n}`, question: `Q${n}`,
    hypotheses: [{ title: `H${n}`, probability: 'high' }], actions: [{ title: 'A', priority: 'now', done: true }, { title: 'B', priority: 'later' }], ...o,
  });

  it('garde les trois derniers diagnostics du bac', () => {
    const d = buildDossier(input({ diagnoses: [diag(1), diag(2), diag(3), diag(4), diag(5, { tankId: 'b' })] }));
    expect(d.previousDiagnoses).toHaveLength(3);
    expect(d.previousDiagnoses[0]).toEqual({ date: '2026-10-02', question: 'Q2', summary: 'Résumé 2', mainHypothesis: 'H2', actions: [{ title: 'A', done: true }, { title: 'B', done: false }] });
    expect(buildDossier(input({ diagnoses: [diag(1, { hypotheses: [] })] })).previousDiagnoses[0].mainHypothesis).toBeUndefined();
  });

  it('résume ce qui s’est passé depuis le diagnostic suivi', () => {
    expect(buildDossier(input()).sinceLastDiagnosis).toBeUndefined();
    const d = buildDossier(input({ followUpOf: diag(20), tests: [test('t', '2026-10-25T10:00:00Z', { no3: 30 })], photos: [{ id: 'p', updatedAt: U, tankId: 'a', date: '2026-10-26T10:00:00Z', width: 1, height: 1 }] }));
    expect(d.sinceLastDiagnosis).toMatchObject({ diagnosisDate: '2026-10-20', daysSince: 7, summary: 'Résumé 20', waterTestsSince: [{ date: '2026-10-25', values: { no3: 30 } }], photosSince: 1 });
  });

  it('compte les photos prises depuis grâce à la liste complète quand elle est fournie', () => {
    const photo = (id: string) => ({ id, updatedAt: U, tankId: 'a', date: '2026-10-26T10:00:00Z', width: 1, height: 1 });
    const d = buildDossier(input({ followUpOf: diag(20), photos: [photo('p1')], allPhotos: [photo('p1'), photo('p2'), photo('p3')] }));
    expect(d.sinceLastDiagnosis?.photosSince).toBe(3);
  });
});

describe('photos jointes', () => {
  it('numérote les photos et indique leur sujet', () => {
    const photos = [
      { id: 'p1', updatedAt: U, tankId: 'a', date: '2026-10-20T10:00:00Z', width: 1, height: 1, caption: 'Vue' },
      { id: 'p2', updatedAt: U, tankId: 'a', inhabitantId: 'i1', date: '2026-10-21T10:00:00Z', width: 1, height: 1 },
    ];
    const d = buildDossier(input({ photos }));
    expect(d.photos).toEqual([
      { file: 'photo-1-2026-10-20.jpg', date: '2026-10-20', caption: 'Vue', subject: 'bac' },
      { file: 'photo-2-2026-10-21.jpg', date: '2026-10-21', caption: undefined, subject: 'habitant' },
    ]);
    expect(photoFileName(photos[1], 4)).toBe('photo-5-2026-10-21.jpg');
  });
});

describe('diagnosticRequest', () => {
  it('rédige la demande avec le problème posé', () => {
    expect(diagnosticRequest('Salon', ' Algues ')).toBe(
      'Diagnostic de mon aquarium « Salon » avec le skill my-aquarium-diagnostic.\nMon problème : Algues\nLe dossier JSON et les photos sont joints.',
    );
  });

  it('demande un bilan général sans question', () => {
    expect(diagnosticRequest('Salon')).toContain('Fais un bilan général et dis-moi ce qui peut être amélioré.');
    expect(diagnosticRequest('Salon', '   ')).toContain('Fais un bilan général');
    expect(diagnosticRequest('Salon', '   ')).not.toContain('Mon problème');
  });

  it('mentionne le diagnostic suivi', () => {
    const t = diagnosticRequest('Salon', 'Algues', '20 octobre');
    expect(t.split('\n')[1]).toBe('C\'est le suivi de ton diagnostic du 20 octobre : dis-moi si le plan a fonctionné (voir sinceLastDiagnosis).');
    expect(diagnosticRequest('Salon', 'Algues').split('\n')).toHaveLength(3);
  });
});
