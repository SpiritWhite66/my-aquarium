// Calculs de l'onglet Eau d'un bac : cases des dernières valeurs, courbes, CO2, repères.
// Fonctions pures (l'écran ne fait que les appeler), donc testables sans composant.

import type { Co2Reading, MaintenanceLog, Observation, SettingChange, Species, Tank, WaterTest } from './models';
import { PARAM_BY_KEY, idealRange, levelOf, measuredParams, type ParamAlert } from './rules';
import { co2Advice, co2FromKhPh, co2FromPhDrop, latestKhPh, trendOf } from './insights';
import { fmt, fmtRange, fmtShortDate, speciesName } from './labels';
import { algaeScore, describeChange } from './settings-history';
import type { AlgaeLevel } from './models';

/** Ce qu'il faut savoir d'un bac pour dessiner son onglet Eau. */
export interface WaterContext {
  tank: Tank;
  tests: WaterTest[]; // du plus ancien au plus récent
  lastTest?: WaterTest;
  alerts: ParamAlert[];
}

/** Dernières valeurs mesurées, une case par paramètre. */
export function paramCells(view: Pick<WaterContext, 'tank' | 'tests' | 'lastTest'> | undefined, species: Species[]) {
  const values = view?.lastTest?.values ?? {};
  return measuredParams(view?.tests ?? []).map((key) => {
    const value = values[key];
    const range = idealRange(key, species, view?.tank);
    return {
      key,
      label: PARAM_BY_KEY[key].short,
      value: fmt(value),
      level: value == null ? ('ok' as const) : levelOf(key, value, range),
      high: value != null && range ? value > range.max : false,
    };
  });
}

/** Une courbe par paramètre mesuré : les paramètres hors plage d'abord, puis l'ordre habituel. */
export function paramCharts(view: WaterContext | undefined, species: Species[], now = Date.now()) {
  if (!view) return [];
  const keys = [...new Set(view.tests.flatMap((t) => Object.keys(t.values)))] as (keyof typeof PARAM_BY_KEY)[];
  const measured = measuredParams(view.tests);
  const order = (k: string) => (view.alerts.some((a) => a.key === k) ? -1 : 0) * 100 + measured.indexOf(k as never);
  return keys
    .sort((a, b) => order(a) - order(b))
    .map((key) => {
      const def = PARAM_BY_KEY[key];
      const range = idealRange(key, species, view.tank);
      const last = view.lastTest?.values[key];
      return {
        key,
        label: def.label,
        range,
        rangeLabel: range ? fmtRange(range.min, range.max, def.unit) : '',
        from: range?.from.length ? range.from.map(speciesName).join(', ') : '',
        conflict: range?.conflict ?? false,
        level: last == null ? ('ok' as const) : levelOf(key, last, range),
        unit: def.unit,
        trend: trendOf(view.tests, key, range, undefined, now),
      };
    });
}

/** Mesures CO2 du bac où l'on a noté un débit ou un drop checker. */
export function lastCo2Reading(readings: Co2Reading[]): Co2Reading | undefined {
  return readings.filter((r) => r.bubblesPerMinute != null || r.dropChecker).at(-1);
}

/** Dernière mesure de pH sur la journée (moins de 14 jours), avec conseil de débit. */
export function phDayReading(readings: Co2Reading[], currentBpm: number | undefined, now = Date.now()) {
  const r = readings.filter((x) => x.phBefore != null && x.phAfter != null).at(-1);
  if (!r || now - new Date(r.date).getTime() > 14 * 864e5) return undefined;
  const m = co2FromPhDrop(r.phBefore!, r.phAfter!);
  return m
    ? { ...co2Advice(m.mgL, currentBpm), ...m, phBefore: r.phBefore!, phAfter: r.phAfter!, phBeforeTime: r.phBeforeTime, phAfterTime: r.phAfterTime, date: r.date }
    : undefined;
}

/** CO2 dissous estimé à partir du dernier KH + pH, avec conseil de débit. */
export function co2Estimate(tests: WaterTest[], currentBpm: number | undefined) {
  const kp = latestKhPh(tests);
  const mg = kp && co2FromKhPh(kp.kh, kp.ph);
  if (!kp || mg == null) return undefined;
  return { ...co2Advice(mg, currentBpm), ...kp };
}

/** Les cinq débits précédents, du plus récent au plus ancien : « 12 (3 mars) · 10 (1 mars) ». */
export function co2HistoryLabel(readings: Co2Reading[]): string {
  return readings
    .slice(-6, -1)
    .reverse()
    .filter((r) => r.bubblesPerMinute != null)
    .map((r) => `${r.bubblesPerMinute} (${fmtShortDate(r.date)})`)
    .join(' · ');
}

/** Niveau d'algues des 16 dernières notes du bac (rapides ou bilans visuels). */
export function algaeNotes(observations: Observation[], tankId: string) {
  return observations
    .filter((o) => o.tankId === tankId)
    .slice(-16)
    .map((o) => ({ date: o.date, level: algaeScore(o) as AlgaeLevel, types: o.algaeTypes?.join(', ') }));
}

/** Doses d'engrais du bac, repérées sur les courbes des nutriments. */
export function fertilizerDoses(logs: MaintenanceLog[], tankId: string) {
  return logs.filter((l) => l.tankId === tankId && l.type === 'fertilize').map((l) => ({ date: l.date, label: l.label }));
}

/** Changements de réglages du matériel, repérés sur les courbes. */
export function settingMarks(changes: SettingChange[], tankId: string) {
  return changes.filter((c) => c.tankId === tankId).map((c) => ({ date: c.date, label: `${c.equipmentName} · ${describeChange(c)}` }));
}

/** Les 20 derniers relevés, du plus récent au plus ancien. */
export function recentTests(tests: WaterTest[] | undefined): WaterTest[] {
  return [...(tests ?? [])].reverse().slice(0, 20);
}

/** « NH4 0,5 · NO2 0 » */
export function testSummary(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([k, v]) => `${PARAM_BY_KEY[k as keyof typeof PARAM_BY_KEY]?.short ?? k} ${fmt(v)}`)
    .join(' · ');
}
