// Calculs de l'onglet Eau, avec des valeurs vérifiées à la main.
import { describe, expect, it } from 'vitest';
import type { Co2Reading, MaintenanceLog, Observation, SettingChange, Species, Tank, WaterTest } from './models';
import {
  algaeNotes, co2Estimate, co2HistoryLabel, fertilizerDoses, lastCo2Reading, paramCells, paramCharts, phDayReading, recentTests, settingMarks, testSummary,
  type WaterContext,
} from './water-view';

const tank = { id: 't', updatedAt: '', name: 'Salon', type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: true, archived: false } as Tank;
const wt = (date: string, values: WaterTest['values']): WaterTest => ({ id: date, updatedAt: '', tankId: 't', date, values });
const fish = (ph: [number, number]): Species => ({ id: 's', updatedAt: '', kind: 'fish', scientificName: 'Danio', commonNames: ['Danio'], source: 'builtin', ph: { min: ph[0], max: ph[1] } });
const NOW = Date.UTC(2026, 9, 31);
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const ctx = (tests: WaterTest[], alerts: WaterContext['alerts'] = []): WaterContext => ({ tank, tests, lastTest: tests.at(-1), alerts });
const reading = (date: string, p: Partial<Co2Reading> = {}): Co2Reading => ({ id: date, updatedAt: '', tankId: 't', date, ...p });

describe('paramCells', () => {
  it('sans relevé : les paramètres principaux, sans valeur', () => {
    const cells = paramCells(undefined, []);
    expect(cells.map((c) => c.key)).toEqual(['temp', 'ph', 'gh', 'kh', 'no2', 'no3', 'nh4', 'po4']);
    expect(cells.every((c) => c.value === '—' && c.level === 'ok' && !c.high)).toBe(true);
  });

  it('classe chaque valeur selon la plage des espèces et signale un dépassement vers le haut', () => {
    const v = ctx([wt(day(0), { ph: 8.4, kh: 4, no3: 5 })]);
    const cells = Object.fromEntries(paramCells(v, [fish([6.5, 7.5])]).map((c) => [c.key, c]));
    expect(cells['ph']).toMatchObject({ label: 'pH', value: '8,4', level: 'danger', high: true });
    expect(cells['kh']).toMatchObject({ value: '4', level: 'ok', high: false });
    expect(cells['no3']).toMatchObject({ level: 'ok' }); // plage plantée 5–25 : 5 est dedans
    expect(cells['gh']).toMatchObject({ value: '—', high: false });
  });

  it('une valeur trop basse n’est pas « haute »', () => {
    const v = ctx([wt(day(0), { ph: 6.1 })]);
    const ph = paramCells(v, [fish([6.5, 7.5])]).find((c) => c.key === 'ph')!;
    expect(ph.high).toBe(false);
    expect(ph.level).toBe('warn'); // 0,4 sous la plage : moins de la moitié de sa largeur (1)
  });

  it('ajoute les paramètres secondaires dès qu’ils ont été mesurés', () => {
    const keys = paramCells(ctx([wt(day(0), { fe: 0.2 })]), []).map((c) => c.key);
    expect(keys).toContain('fe');
    expect(keys).not.toContain('mg');
  });
});

describe('paramCharts', () => {
  it('rien sans bac', () => expect(paramCharts(undefined, [])).toEqual([]));

  it('met les paramètres hors plage en premier, puis garde l’ordre habituel', () => {
    const tests = [wt(day(0), { temp: 25, ph: 7, no3: 80 }), wt(day(1), { temp: 25, ph: 7, no3: 80 })];
    const v = ctx(tests, [{ key: 'no3', value: 80, range: { min: 5, max: 25 }, level: 'danger', direction: 'high' }]);
    expect(paramCharts(v, [], NOW).map((c) => c.key)).toEqual(['no3', 'temp', 'ph']);
  });

  it('décrit la plage, ses espèces et le niveau actuel', () => {
    const v = ctx([wt(day(0), { ph: 8.1 })]);
    const [c] = paramCharts(v, [fish([6.5, 7.5])], NOW);
    expect(c).toMatchObject({ key: 'ph', label: 'pH', rangeLabel: '6,5–7,5', from: 'Danio', conflict: false, level: 'danger', unit: '' });
  });

  it('sans espèce, la plage vient du défaut et n’a pas d’origine', () => {
    const [c] = paramCharts(ctx([wt(day(0), { ph: 7 })]), [], NOW);
    expect(c).toMatchObject({ rangeLabel: '6–7,5', from: '', level: 'ok' });
  });

  it('signale des espèces incompatibles entre elles', () => {
    const [c] = paramCharts(ctx([wt(day(0), { ph: 7 })]), [fish([5, 6]), fish([7, 8])], NOW);
    expect(c.conflict).toBe(true);
  });

  it('ajoute la tendance quand elle est nette', () => {
    const tests = [20, 22, 24, 26, 28].map((d, i) => wt(day(d), { no3: 10 + i * 10 }));
    const [c] = paramCharts(ctx(tests), [], NOW);
    expect(c.trend?.last).toBe(50);
    expect(c.trend?.perWeek).toBeGreaterThan(0);
  });

  it('ne force pas de tendance avec moins de 3 mesures', () => {
    expect(paramCharts(ctx([wt(day(28), { no3: 10 }), wt(day(29), { no3: 90 })]), [], NOW)[0].trend).toBeUndefined();
  });
});

describe('CO2', () => {
  it('lastCo2Reading ignore les mesures sans débit ni drop checker', () => {
    const list = [reading(day(0), { bubblesPerMinute: 3 }), reading(day(1), { phBefore: 7, phAfter: 6 })];
    expect(lastCo2Reading(list)?.date).toBe(day(0));
    expect(lastCo2Reading([reading(day(2), { dropChecker: 'green' })])?.dropChecker).toBe('green');
    expect(lastCo2Reading([reading(day(2))])).toBeUndefined();
  });

  it('phDayReading : une baisse d’un point de pH = 30 mg/L', () => {
    const r = reading(day(29), { phBefore: 7.2, phAfter: 6.2, phBeforeTime: '09:00', phAfterTime: '17:00' });
    const out = phDayReading([r], 3, NOW);
    expect(out).toMatchObject({ drop: 1, mgL: 30, level: 'ok', phBefore: 7.2, phAfter: 6.2, phBeforeTime: '09:00', phAfterTime: '17:00', date: day(29), suggestedBpm: 3 });
  });

  it('phDayReading : prend la dernière mesure complète', () => {
    const list = [reading(day(27), { phBefore: 7, phAfter: 6 }), reading(day(29), { phBefore: 7, phAfter: 6.5 }), reading(day(30), { phBefore: 7 })];
    expect(phDayReading(list, undefined, NOW)?.date).toBe(day(29));
  });

  it('phDayReading : trop ancienne (plus de 14 jours) ou absente', () => {
    expect(phDayReading([reading(day(0), { phBefore: 7, phAfter: 6 })], 3, NOW)).toBeUndefined();
    expect(phDayReading([reading(day(17), { phBefore: 7, phAfter: 6 })], 3, NOW)).toBeDefined();
    expect(phDayReading([], 3, NOW)).toBeUndefined();
  });

  it('phDayReading : pH invalides', () => {
    expect(phDayReading([reading(day(30), { phBefore: 0, phAfter: 6 })], 3, NOW)).toBeUndefined();
  });

  it('co2Estimate : 3 × KH × 10^(7 − pH)', () => {
    expect(co2Estimate([wt(day(0), { kh: 4, ph: 6.6 })], 4)).toMatchObject({ mgL: 30.1, kh: 4, ph: 6.6, level: 'ok' });
    expect(co2Estimate([wt(day(0), { kh: 8, ph: 6.4 })], 4)).toMatchObject({ mgL: 95.5, level: 'danger' });
  });

  it('co2Estimate : rien sans couple KH + pH', () => {
    expect(co2Estimate([wt(day(0), { ph: 7 })], 4)).toBeUndefined();
    expect(co2Estimate([], undefined)).toBeUndefined();
  });

  it('co2HistoryLabel : les cinq mesures précédentes avec débit, de la plus récente à la plus ancienne', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => reading(day(n), { bubblesPerMinute: n }));
    expect(co2HistoryLabel(list)).toMatch(/^6 \(.+\) · 5 \(.+\) · 4 \(.+\) · 3 \(.+\) · 2 \(.+\)$/);
  });

  it('co2HistoryLabel : saute les mesures sans débit et la mesure la plus récente', () => {
    const list = [reading(day(1), { bubblesPerMinute: 2 }), reading(day(2), { phBefore: 7 }), reading(day(3), { bubblesPerMinute: 4 })];
    expect(co2HistoryLabel(list)).toMatch(/^2 \(/);
    expect(co2HistoryLabel([])).toBe('');
  });
});

describe('repères et listes', () => {
  const obs = (id: string, tankId: string, algaeLevel?: 0 | 1 | 2 | 3, algaeTypes?: string[]): Observation =>
    ({ id, updatedAt: '', tankId, date: day(Number(id)), overall: 'good', findings: [], algaeLevel, algaeTypes });

  it('algaeNotes : les 16 dernières notes du bac seulement', () => {
    const list = [...Array.from({ length: 20 }, (_, i) => obs(String(i + 1), 't', 1)), obs('99', 'autre', 3)];
    const out = algaeNotes(list, 't');
    expect(out).toHaveLength(16);
    expect(out[0].date).toBe(day(5));
    expect(out.at(-1)!.date).toBe(day(20));
  });

  it('algaeNotes : niveau et types d’algues', () => {
    expect(algaeNotes([obs('1', 't', 2, ['brosse', 'filament'])], 't')).toEqual([{ date: day(1), level: 2, types: 'brosse, filament' }]);
    expect(algaeNotes([obs('1', 't')], 't')[0]).toMatchObject({ level: 0, types: undefined });
  });

  it('fertilizerDoses : seulement les engrais du bac', () => {
    const log = (id: string, tankId: string, type: MaintenanceLog['type']): MaintenanceLog => ({ id, updatedAt: '', tankId, type, label: 'L' + id, date: day(1) });
    const out = fertilizerDoses([log('1', 't', 'fertilize'), log('2', 't', 'water_change'), log('3', 'x', 'fertilize')], 't');
    expect(out).toEqual([{ date: day(1), label: 'L1' }]);
  });

  it('settingMarks : seulement les réglages du bac, avec le nom du matériel', () => {
    const ch = (id: string, tankId: string): SettingChange =>
      ({ id, updatedAt: '', tankId, equipmentId: 'e', equipmentName: 'Rampe', date: day(1), field: 'light.intensityPct', from: '50', to: '60' });
    const out = settingMarks([ch('1', 't'), ch('2', 'x')], 't');
    expect(out).toHaveLength(1);
    expect(out[0].label).toMatch(/^Rampe · /);
    expect(out[0].date).toBe(day(1));
  });

  it('recentTests : 20 derniers relevés, du plus récent au plus ancien', () => {
    const tests = Array.from({ length: 25 }, (_, i) => wt(day(i), { ph: 7 }));
    const out = recentTests(tests);
    expect(out).toHaveLength(20);
    expect(out[0].date).toBe(day(24));
    expect(tests[0].date).toBe(day(0)); // la liste d’origine n’est pas modifiée
    expect(recentTests(undefined)).toEqual([]);
  });

  it('testSummary : abréviations connues, clé brute sinon', () => {
    expect(testSummary({ ph: 7.2, no3: 10 })).toBe('pH 7,2 · NO3 10');
    expect(testSummary({ inconnu: 1 })).toBe('inconnu 1');
    expect(testSummary({})).toBe('');
  });
});
