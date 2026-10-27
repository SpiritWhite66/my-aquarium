import { describe, expect, it } from 'vitest';
import { measureStatus, sinceDiagnosis, type FollowUpData } from './follow-up';
import type { Diagnosis, Observation, WaterTest } from './models';

const U = '';
const SINCE = '2026-10-10T10:00:00Z';
const diag = (o: Partial<Diagnosis> = {}): Diagnosis => ({
  id: 'g',
  updatedAt: U,
  tankId: 'a',
  date: SINCE,
  summary: 'Résumé',
  hypotheses: [],
  actions: [],
  ...o,
});
const data = (o: Partial<FollowUpData> = {}): FollowUpData => ({
  tests: [],
  co2Readings: [],
  photos: [],
  logs: [],
  settingChanges: [],
  observations: [],
  ...o,
});
const wt = (id: string, date: string, values: WaterTest['values'], tankId = 'a'): WaterTest => ({
  id,
  updatedAt: U,
  tankId,
  date,
  values,
});
const measure = (label: string, d: FollowUpData = data()) =>
  measureStatus(diag({ followUp: { inDays: 7, measure: [label] } }), d)[0];

describe('mesures demandées', () => {
  it('sans suivi prévu, aucune mesure', () => {
    expect(measureStatus(diag(), data())).toEqual([]);
    expect(measureStatus(diag({ followUp: { inDays: 7 } }), data())).toEqual([]);
  });

  it('une mesure inconnue est listée sans verdict', () => {
    expect(measure('Observer les poissons')).toEqual({ label: 'Observer les poissons' });
  });

  it('un paramètre est fait quand un relevé du bac, postérieur au diagnostic, le contient', () => {
    const d = data({ tests: [wt('1', '2026-10-12T10:00:00Z', { no3: 25 })] });
    expect(measure('Mesurer le NO3', d)).toEqual({
      label: 'Mesurer le NO3',
      done: true,
      detail: '25',
    });
    expect(measure('Mesurer le NO3')).toEqual({
      label: 'Mesurer le NO3',
      done: false,
      detail: undefined,
    });
  });

  it('écrit les décimales à la française et prend le relevé le plus récent de la liste', () => {
    const d = data({
      tests: [
        wt('1', '2026-10-12T10:00:00Z', { no3: 25 }),
        wt('2', '2026-10-14T10:00:00Z', { no3: 7.5 }),
      ],
    });
    expect(measure('nitrates', d).detail).toBe('7,5');
  });

  it('ignore les relevés antérieurs, du jour même du diagnostic, d’un autre bac, ou sans cette valeur', () => {
    const d = data({
      tests: [
        wt('1', '2026-10-09T10:00:00Z', { no3: 1 }),
        wt('2', SINCE, { no3: 2 }),
        wt('3', '2026-10-12T10:00:00Z', { no3: 3 }, 'b'),
        wt('4', '2026-10-12T10:00:00Z', { ph: 7 }),
      ],
    });
    expect(measure('NO3', d).done).toBe(false);
  });

  it.each([
    ['PO4', 'po4'],
    ['phosphates', 'po4'],
    ['NH3', 'nh4'],
    ['ammoniaque', 'nh4'],
    ['NO2', 'no2'],
    ['nitrites', 'no2'],
    ['GH', 'gh'],
    ['KH', 'kh'],
    ['Fer', 'fe'],
    ['Fe', 'fe'],
    ['Potassium', 'k'],
    ['K', 'k'],
    ['Magnésium', 'mg'],
    ['Mg', 'mg'],
    ['pH', 'ph'],
    ['Température', 'temp'],
    ['temp', 'temp'],
  ] as const)('« %s » cherche le paramètre %s', (label, key) => {
    const d = data({ tests: [wt('1', '2026-10-12T10:00:00Z', { [key]: 3 })] });
    expect(measure(label, d)).toMatchObject({ done: true, detail: '3' });
  });

  it('plusieurs paramètres : fait seulement s’ils sont tous mesurés, détail par paramètre', () => {
    const both = data({ tests: [wt('1', '2026-10-12T10:00:00Z', { no3: 25, po4: 0.8 })] });
    expect(measure('NO3 et PO4', both)).toEqual({
      label: 'NO3 et PO4',
      done: true,
      detail: 'NO3 25 · PO4 0,8',
    });
    const one = data({ tests: [wt('1', '2026-10-12T10:00:00Z', { no3: 25 })] });
    expect(measure('NO3 et PO4', one)).toEqual({
      label: 'NO3 et PO4',
      done: false,
      detail: 'NO3 25',
    });
    expect(
      measure('NO3 et PO4', data({ tests: [wt('1', '2026-10-12T10:00:00Z', { ph: 7 })] })).detail,
    ).toBeUndefined();
    expect(measure('NO3 et NITRATES', both)).toMatchObject({ done: true, detail: '25' });
  });

  it('prend la dernière valeur de chaque paramètre, même dans des relevés différents', () => {
    const d = data({
      tests: [
        wt('1', '2026-10-12T10:00:00Z', { no3: 25 }),
        wt('2', '2026-10-13T10:00:00Z', { po4: 0.8 }),
      ],
    });
    expect(measure('NO3 et PO4', d)).toMatchObject({ done: true, detail: 'NO3 25 · PO4 0,8' });
  });

  describe('décrochage de pH', () => {
    const reading = (o = {}) => ({
      id: 'r',
      updatedAt: U,
      tankId: 'a',
      date: '2026-10-12T10:00:00Z',
      phBefore: 7.4,
      phAfter: 6.6,
      ...o,
    });
    it.each([
      'pH à 11h30 et 21h',
      'pH avant la lumière',
      'pH après CO2',
      'pH en fin d’éclairage',
      'décrochage',
      'Baisse de pH',
    ])('« %s » attend une mesure du jour', (label) => {
      expect(measure(label).done).toBe(false);
      expect(measure(label, data({ co2Readings: [reading()] }))).toEqual({
        label,
        done: true,
        detail: 'pH 7,4 → 6,6',
      });
    });
    it('ne compte que les mesures complètes, récentes, du bac, et prend la dernière', () => {
      const d = data({
        co2Readings: [
          reading({ date: '2026-10-14T10:00:00Z', phBefore: 7.5, phAfter: 6.5 }),
          reading({ phAfter: undefined, date: '2026-10-15T10:00:00Z' }),
          reading({ phBefore: undefined, date: '2026-10-15T10:00:00Z' }),
          reading({ tankId: 'b', date: '2026-10-16T10:00:00Z' }),
          reading({ date: '2026-10-01T10:00:00Z' }),
          reading({ date: SINCE }),
        ],
      });
      expect(measure('décrochage', d).detail).toBe('pH 7,5 → 6,5');
      expect(measure('décrochage', data({ co2Readings: [reading({ tankId: 'b' })] })).done).toBe(
        false,
      );
      expect(measure('décrochage', data({ co2Readings: [reading({ date: SINCE })] })).done).toBe(
        false,
      );
    });
  });

  describe('photo', () => {
    const photo = (id: string, o = {}) => ({
      id,
      updatedAt: U,
      tankId: 'a',
      date: '2026-10-12T10:00:00Z',
      width: 1,
      height: 1,
      ...o,
    });
    it('compte les photos du bac prises depuis', () => {
      expect(measure('Prendre une photo')).toEqual({
        label: 'Prendre une photo',
        done: false,
        detail: undefined,
      });
      const d = data({
        photos: [
          photo('1'),
          photo('2'),
          photo('3', { tankId: 'b' }),
          photo('4', { date: '2026-10-01T10:00:00Z' }),
          photo('5', { date: SINCE }),
        ],
      });
      expect(measure('Photos du bac', d)).toEqual({
        label: 'Photos du bac',
        done: true,
        detail: '2 photo(s)',
      });
    });
  });
});

describe('résumé depuis le diagnostic', () => {
  const today = '2026-10-20';
  const full = diag({
    question: 'Algues ?',
    hypotheses: [{ title: 'Trop de lumière', probability: 'high' }],
    actions: [
      { title: 'Réduire', priority: 'now', done: true },
      { title: 'Observer', priority: 'later' },
    ],
    followUp: { inDays: 7, measure: ['NO3', 'Observer'] },
  });

  it('reprend le diagnostic, son suivi prévu et les actions', () => {
    const s = sinceDiagnosis(full, data(), today);
    expect(s).toMatchObject({
      diagnosisDate: '2026-10-10',
      daysSince: 10,
      followUpPlannedFor: '2026-10-17',
      question: 'Algues ?',
      summary: 'Résumé',
      mainHypothesis: 'Trop de lumière',
      actions: [
        { title: 'Réduire', priority: 'now', done: true },
        { title: 'Observer', priority: 'later', done: false },
      ],
      requestedMeasures: [
        { measure: 'NO3', done: false, value: undefined },
        { measure: 'Observer', done: undefined, value: undefined },
      ],
    });
  });

  it('sans suivi ni hypothèse, ces champs restent vides', () => {
    const s = sinceDiagnosis(diag(), data(), today);
    expect(s.followUpPlannedFor).toBeUndefined();
    expect(s.mainHypothesis).toBeUndefined();
    expect(s.requestedMeasures).toEqual([]);
    expect(s.actions).toEqual([]);
  });

  it('liste ce qui s’est passé depuis, pour ce bac seulement', () => {
    const log = (id: string, o = {}) => ({
      id,
      updatedAt: U,
      tankId: 'a',
      type: 'water_change' as const,
      label: 'Eau',
      date: '2026-10-12T10:00:00Z',
      ...o,
    });
    const s = sinceDiagnosis(
      full,
      data({
        tests: [
          wt('1', '2026-10-12T10:00:00Z', { no3: 20 }),
          wt('2', '2026-10-12T10:00:00Z', { no3: 99 }, 'b'),
          wt('3', SINCE, { no3: 98 }),
        ],
        logs: [
          log('1', { note: 'ok' }),
          log('2', { type: 'fertilize', label: 'Engrais' }),
          log('3', { type: 'fertilize', label: 'Engrais' }),
          log('4', { tankId: 'b' }),
          log('5', { date: SINCE }),
        ],
        settingChanges: [
          {
            id: 's1',
            updatedAt: U,
            tankId: 'a',
            equipmentId: 'e',
            equipmentName: 'Rampe',
            date: '2026-10-11T10:00:00Z',
            field: 'light.intensityPct',
            from: '80 %',
            to: '60 %',
          },
          {
            id: 's2',
            updatedAt: U,
            tankId: 'b',
            equipmentId: 'e',
            equipmentName: 'Autre',
            date: '2026-10-11T10:00:00Z',
            field: 'light.intensityPct',
          },
        ],
        photos: [
          { id: 'p', updatedAt: U, tankId: 'a', date: '2026-10-13T10:00:00Z', width: 1, height: 1 },
          { id: 'q', updatedAt: U, tankId: 'a', date: SINCE, width: 1, height: 1 },
        ],
      }),
      today,
    );
    expect(s.waterTestsSince).toEqual([{ date: '2026-10-12', values: { no3: 20 } }]);
    expect(s.maintenanceSince).toEqual([{ date: '2026-10-12', label: 'Eau', note: 'ok' }]);
    expect(s.fertilizerDosesSince).toBe(2);
    expect(s.settingChangesSince).toEqual([
      { date: '2026-10-11', change: 'Rampe · Intensité : 80 % → 60 %' },
    ]);
    expect(s.photosSince).toBe(1);
  });

  describe('niveau d’algues', () => {
    const obs = (
      id: string,
      date: string,
      algaeLevel: number | undefined,
      o: Partial<Observation> = {},
    ): Observation => ({
      id,
      updatedAt: U,
      tankId: 'a',
      date,
      overall: 'watch',
      findings: [],
      algaeLevel: algaeLevel as 0,
      ...o,
    });

    it('compare la moyenne des 30 jours avant avec celle des notes depuis', () => {
      const s = sinceDiagnosis(
        full,
        data({
          observations: [
            obs('b1', '2026-10-05T10:00:00Z', 2),
            obs('b2', '2026-10-08T10:00:00Z', 3),
            obs('a1', '2026-10-15T10:00:00Z', 1),
            obs('a2', '2026-10-18T10:00:00Z', 0),
            obs('a3', '2026-10-19T10:00:00Z', 0),
          ],
        }),
        today,
      );
      expect(s.algaeLevel).toEqual({ before: 2.5, since: 0.3, notesSince: 3 });
    });

    it('la limite des 30 jours est incluse, le jour du diagnostic compte avant', () => {
      const s = sinceDiagnosis(
        full,
        data({
          observations: [
            obs('o', '2026-09-10T10:00:00Z', 3),
            obs('p', '2026-09-09T10:00:00Z', 0),
            obs('q', SINCE, 1),
          ],
        }),
        today,
      );
      expect(s.algaeLevel.before).toBe(2);
      expect(s.algaeLevel.since).toBeUndefined();
      expect(s.algaeLevel.notesSince).toBe(0);
    });

    it('ignore les notes d’un autre bac et dérive le niveau des bilans visuels', () => {
      const s = sinceDiagnosis(
        full,
        data({
          observations: [
            obs('x', '2026-10-15T10:00:00Z', 3, { tankId: 'b' }),
            obs('y', '2026-10-16T10:00:00Z', undefined, {
              findings: [{ category: 'algae', severity: 'warn', title: 't' } as never],
            }),
          ],
        }),
        today,
      );
      expect(s.algaeLevel).toEqual({ before: undefined, since: 2, notesSince: 1 });
    });
  });
});
