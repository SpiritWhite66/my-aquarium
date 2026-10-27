import { describe, expect, it } from 'vitest';
import type { Diagnosis } from './models';
import { measureStatus, sinceDiagnosis } from './follow-up';

const diag = {
  id: 'd',
  updatedAt: '',
  tankId: 't',
  date: '2026-10-26T10:00:00.000Z',
  summary: 'Carence',
  hypotheses: [{ title: 'Carence NO3/PO4', probability: 'high' }],
  actions: [
    { title: 'Changement d’eau', priority: 'now', done: true },
    { title: 'Engrais', priority: 'soon' },
  ],
  followUp: {
    inDays: 14,
    measure: [
      'NO3',
      'PO4',
      'NH4 et NO2',
      'pH à 11h30 et à 21h',
      'photo du même angle',
      'croissance des Anubias',
      'NO3 vers 10 mg/L',
    ],
  },
} as Diagnosis;

const data = {
  tests: [
    {
      id: 'a',
      updatedAt: '',
      tankId: 't',
      date: '2026-10-20T10:00:00Z',
      values: { no3: 0, po4: 0 },
    },
    {
      id: 'b',
      updatedAt: '',
      tankId: 't',
      date: '2026-11-02T10:00:00Z',
      values: { no3: 10, nh4: 0 },
    },
  ],
  co2Readings: [
    {
      id: 'c',
      updatedAt: '',
      tankId: 't',
      date: '2026-11-01T21:00:00Z',
      phBefore: 7.3,
      phAfter: 6.4,
    },
  ],
  photos: [],
  logs: [
    {
      id: 'l',
      updatedAt: '',
      tankId: 't',
      type: 'fertilize' as const,
      label: 'Engrais — NPK 5 ml',
      date: '2026-10-28T10:00:00Z',
    },
  ],
  settingChanges: [],
  observations: [
    {
      id: 'o1',
      updatedAt: '',
      tankId: 't',
      date: '2026-10-25T10:00:00Z',
      overall: 'problem' as const,
      findings: [],
      manual: true,
      algaeLevel: 3 as const,
    },
    {
      id: 'o2',
      updatedAt: '',
      tankId: 't',
      date: '2026-11-02T10:00:00Z',
      overall: 'watch' as const,
      findings: [],
      manual: true,
      algaeLevel: 1 as const,
    },
  ],
};

describe('suivi de diagnostic', () => {
  it('vérifie les mesures demandées depuis le diagnostic', () => {
    const s = measureStatus(diag, data);
    expect(s.map((m) => m.done)).toEqual([true, false, false, true, false, undefined, true]);
    expect(s[0].detail).toBe('10');
    expect(s[3].detail).toBe('pH 7,3 → 6,4');
  });
  it('résume ce qui a changé', () => {
    const r = sinceDiagnosis(diag, data, '2026-11-09');
    expect(r.daysSince).toBe(14);
    expect(r.followUpPlannedFor).toBe('2026-11-09');
    expect(r.fertilizerDosesSince).toBe(1);
    expect(r.algaeLevel).toEqual({ before: 3, since: 1, notesSince: 1 });
    expect(r.waterTestsSince).toHaveLength(1);
  });
});

describe('reconnaissance des mesures demandées', () => {
  const run = (label: string) => {
    const d = { ...diag, followUp: { inDays: 7, measure: [label] } } as Diagnosis;
    const fe = {
      ...data,
      tests: [
        {
          id: 'x',
          updatedAt: '',
          tankId: 't',
          date: '2026-11-01T10:00:00Z',
          values: { fe: 0.1, k: 8, mg: 12, ph: 6.9, temp: 24, gh: 7, kh: 4 },
        },
      ],
      photos: [],
    };
    return measureStatus(d, fe)[0];
  };
  it.each([
    ['Fe (test colorimétrique)', true],
    ['Potassium et magnésium', true],
    ['Mg 10 mg/L et K 15 mg/L', true],
    ['GH / KH', true],
    ['Température de l’eau', true],
    ['pH', true],
    ['NO3 (JBL)', false], // pas de NO3 dans ce relevé
  ])('« %s » → fait : %s', (label, done) => expect(run(label).done).toBe(done));

  it('ne prend pas « photopériode » pour une photo', () => {
    expect(run('Durée de la photopériode').done).toBeUndefined();
  });
  it('ne prend pas « temps » pour une température', () => {
    expect(run('Observer dans le temps').done).toBeUndefined();
  });
  it('reconnaît un pH avant / après CO2 comme une baisse de pH', () => {
    const r = run('pH avant l’ouverture du CO2 puis en fin d’éclairage');
    expect(r.done).toBe(true);
    expect(r.detail).toBe('pH 7,3 → 6,4'); // la mesure de baisse de pH du jeu de données, pas le pH simple
  });
  it('ne confond pas « mg/L » avec le magnésium', () => {
    expect(run('NO3 vers 10 mg/L').label).toBe('NO3 vers 10 mg/L');
    expect(run('NO3 vers 10 mg/L').done).toBe(false);
  });
});
