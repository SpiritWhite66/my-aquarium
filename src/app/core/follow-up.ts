// Suivi d'un diagnostic : ce qui a été fait, mesuré et changé depuis, pour que le diagnostic
// suivant juge l'effet du plan d'action au lieu de repartir de zéro.

import type { Co2Reading, Diagnosis, MaintenanceLog, Observation, ParamKey, Photo, SettingChange, WaterTest } from './models';
import { addDays, daysBetween, localDay } from './dates';
import { PARAM_BY_KEY } from './rules';
import { algaeScore, describeChange } from './settings-history';

/** Mots reconnus dans les mesures demandées par l'IA (« NO3 », « pH à 11h30 et 21h », « photo »…). */
const MEASURE_PATTERNS: { re: RegExp; kind: 'param' | 'phDrop' | 'photo'; keys?: ParamKey[] }[] = [
  { re: /\bph\b.*(\d{1,2}\s*h\b|avant|apr[èe]s|fin d)|d[ée]crochage|baisse de ph/i, kind: 'phDrop' },
  { re: /\bphotos?\b/i, kind: 'photo' },
  { re: /\bno3\b|nitrate/i, kind: 'param', keys: ['no3'] },
  { re: /\bpo4\b|phosphate/i, kind: 'param', keys: ['po4'] },
  { re: /\bnh[34]\b|ammo/i, kind: 'param', keys: ['nh4'] },
  { re: /\bno2\b|nitrite/i, kind: 'param', keys: ['no2'] },
  { re: /\bgh\b/i, kind: 'param', keys: ['gh'] },
  { re: /\bkh\b/i, kind: 'param', keys: ['kh'] },
  { re: /\bfe\b|\bfer\b/i, kind: 'param', keys: ['fe'] },
  { re: /\bk\b|potassium/i, kind: 'param', keys: ['k'] },
  { re: /\bmg\b(?!\s*\/)|magn[ée]sium/i, kind: 'param', keys: ['mg'] },
  { re: /\bph\b/i, kind: 'param', keys: ['ph'] },
  { re: /\btemp(?:[ée]rature)?\b/i, kind: 'param', keys: ['temp'] },
];

const dec = (n: number) => String(n).replace('.', ',');

export interface MeasureStatus {
  label: string;
  /** true : fait depuis le diagnostic ; false : pas encore ; undefined : impossible à vérifier. */
  done?: boolean;
  detail?: string;
}

export interface FollowUpData {
  tests: WaterTest[];
  co2Readings: Co2Reading[];
  photos: Photo[];
  logs: MaintenanceLog[];
  settingChanges: SettingChange[];
  observations: Observation[];
}

/** Pour chaque mesure demandée par le diagnostic : a-t-elle été faite depuis ? */
export function measureStatus(diagnosis: Diagnosis, data: FollowUpData): MeasureStatus[] {
  const since = diagnosis.date;
  const tests = data.tests.filter((t) => t.tankId === diagnosis.tankId && t.date > since);
  return (diagnosis.followUp?.measure ?? []).map((label) => {
    const p = MEASURE_PATTERNS.find((m) => m.re.test(label));
    if (!p) return { label };
    if (p.kind === 'phDrop') {
      const r = data.co2Readings.filter((x) => x.tankId === diagnosis.tankId && x.date > since && x.phBefore != null && x.phAfter != null).at(-1);
      return { label, done: !!r, detail: r ? `pH ${dec(r.phBefore!)} → ${dec(r.phAfter!)}` : undefined };
    }
    if (p.kind === 'photo') {
      const n = data.photos.filter((x) => x.tankId === diagnosis.tankId && x.date > since).length;
      return { label, done: n > 0, detail: n ? `${n} photo(s)` : undefined };
    }
    const keys = MEASURE_PATTERNS.filter((m) => m.kind === 'param' && m.re.test(label)).flatMap((m) => m.keys!);
    const found = [...new Set(keys)].map((k) => ({ k, v: tests.filter((t) => t.values[k] != null).at(-1)?.values[k] }));
    const done = found.every((f) => f.v != null);
    const known = found.filter((f) => f.v != null);
    const detail = known.length === 1 && found.length === 1 ? dec(known[0].v!) : known.map((f) => `${PARAM_BY_KEY[f.k].short} ${dec(f.v!)}`).join(' · ');
    return { label, done, detail: detail || undefined };
  });
}

/** Résumé de tout ce qui s'est passé depuis un diagnostic, pour le dossier du suivant. */
export function sinceDiagnosis(diagnosis: Diagnosis, data: FollowUpData, today: string) {
  const since = diagnosis.date;
  const tank = diagnosis.tankId;
  const mine = <T extends { tankId?: string; date: string }>(list: T[]) => list.filter((x) => x.tankId === tank && x.date > since);
  const obs = data.observations.filter((o) => o.tankId === tank);
  const avg = (list: Observation[]) => (list.length ? Math.round((list.reduce((n, o) => n + algaeScore(o), 0) / list.length) * 10) / 10 : undefined);
  const before = obs.filter((o) => o.date <= since && daysBetween(localDay(o.date), localDay(since)) <= 30);
  const after = obs.filter((o) => o.date > since);
  const logs = mine(data.logs);
  return {
    diagnosisDate: localDay(since),
    daysSince: daysBetween(localDay(since), today),
    followUpPlannedFor: diagnosis.followUp ? addDays(localDay(since), diagnosis.followUp.inDays) : undefined,
    question: diagnosis.question,
    summary: diagnosis.summary,
    mainHypothesis: diagnosis.hypotheses[0]?.title,
    actions: diagnosis.actions.map((a) => ({ title: a.title, priority: a.priority, done: !!a.done })),
    requestedMeasures: measureStatus(diagnosis, data).map((m) => ({ measure: m.label, done: m.done, value: m.detail })),
    waterTestsSince: mine(data.tests).map((t) => ({ date: localDay(t.date), values: t.values })),
    maintenanceSince: logs.filter((l) => l.type !== 'fertilize').map((l) => ({ date: localDay(l.date), label: l.label, note: l.note })),
    fertilizerDosesSince: logs.filter((l) => l.type === 'fertilize').length,
    settingChangesSince: mine(data.settingChanges).map((c) => ({ date: localDay(c.date), change: `${c.equipmentName} · ${describeChange(c)}` })),
    algaeLevel: { before: avg(before), since: avg(after), notesSince: after.length },
    photosSince: mine(data.photos).length,
  };
}

export type SinceDiagnosis = ReturnType<typeof sinceDiagnosis>;
