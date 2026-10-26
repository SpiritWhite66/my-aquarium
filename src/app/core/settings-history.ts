// Historique des réglages du matériel (intensité et horaires d'éclairage, CO2, chauffage, débit)
// et mise en regard avec les algues signalées avant et après chaque changement.

import type { DailySchedule, Equipment, Observation, Photo, SettingChange } from './models';
import { fmt } from './labels';
import { photoperiod } from './insights';

type Field = SettingChange['field'];

const sched = (s?: DailySchedule) => (s?.on && s.off ? `${s.on}–${s.off}` : undefined);
const pct = (n?: number) => (n == null ? undefined : `${fmt(n)} %`);
const hours = (n?: number) => (n == null ? undefined : `${fmt(n)} h`);

/** Réglages suivis : libellé et lecture de la valeur affichable. */
const TRACKED: { field: Field; label: string; read: (e: Partial<Equipment>) => string | undefined }[] = [
  { field: 'light.intensityPct', label: 'Intensité', read: (e) => pct(e.light?.intensityPct) },
  { field: 'light.schedule', label: 'Horaires d’éclairage', read: (e) => sched(e.light?.schedule) },
  { field: 'light.siesta', label: 'Sieste', read: (e) => sched(e.light?.siesta) },
  { field: 'light.photoperiod', label: 'Durée d’éclairage', read: (e) => hours(e.light ? photoperiod(e.light) : undefined) },
  { field: 'light.rampMinutes', label: 'Lever / coucher', read: (e) => (e.light?.rampMinutes == null ? undefined : `${e.light.rampMinutes} min`) },
  { field: 'co2.schedule', label: 'Horaires CO2', read: (e) => sched(e.co2?.schedule) },
  { field: 'heater.setpointC', label: 'Consigne chauffage', read: (e) => (e.heater?.setpointC == null ? undefined : `${fmt(e.heater.setpointC)} °C`) },
  { field: 'filter.flowLh', label: 'Débit du filtre', read: (e) => (e.filter?.flowLh == null ? undefined : `${e.filter.flowLh} L/h`) },
];

export const SETTING_LABELS = Object.fromEntries(TRACKED.map((t) => [t.field, t.label])) as Record<Field, string>;

export type SettingDiff = Pick<SettingChange, 'field' | 'from' | 'to'>;

/** Réglages qui ont changé entre deux versions d'un équipement. */
export function diffSettings(before: Partial<Equipment>, after: Partial<Equipment>): SettingDiff[] {
  const out: SettingDiff[] = [];
  for (const t of TRACKED) {
    const from = t.read(before);
    const to = t.read(after);
    if (from !== to) out.push({ field: t.field, from, to });
  }
  return out;
}

export function describeChange(c: Pick<SettingChange, 'field' | 'from' | 'to'>): string {
  return `${SETTING_LABELS[c.field]} : ${c.from ?? '—'} → ${c.to ?? '—'}`;
}

export interface AlgaeWindow {
  /** Signalements d'algues non résolus dans les bilans visuels de la période. */
  findings: number;
  /** Bilans visuels faits sur la période (0 : rien pour comparer). */
  checks: number;
}

export interface ChangeEffect {
  before: AlgaeWindow;
  after: AlgaeWindow;
  /** Photo du bac la plus proche avant et après le changement. */
  photoBefore?: Photo;
  photoAfter?: Photo;
  /** Jours écoulés depuis le changement (le recul pour juger). */
  daysSince: number;
}

const DAY = 864e5;

function algae(observations: Observation[], from: number, to: number): AlgaeWindow {
  const inWindow = observations.filter((o) => {
    const t = new Date(o.date).getTime();
    return t >= from && t < to;
  });
  return {
    checks: inWindow.length,
    findings: inWindow.reduce((n, o) => n + o.findings.filter((f) => f.category === 'algae' && f.severity !== 'info' && !f.resolved).length, 0),
  };
}

/**
 * Compare la période avant et après un changement de réglage (par défaut 30 jours de chaque côté,
 * l'après s'arrêtant au changement suivant du même réglage).
 */
export function changeEffect(
  change: SettingChange,
  observations: Observation[],
  photos: Photo[],
  now: Date,
  nextChangeDate?: string,
  windowDays = 30,
): ChangeEffect {
  const at = new Date(change.date).getTime();
  const end = Math.min(at + windowDays * DAY, nextChangeDate ? new Date(nextChangeDate).getTime() : Infinity, now.getTime() + 1);
  const mine = observations.filter((o) => o.tankId === change.tankId);
  const tankPhotos = photos.filter((p) => p.tankId === change.tankId && !p.inhabitantId).sort((a, b) => a.date.localeCompare(b.date));
  return {
    before: algae(mine, at - windowDays * DAY, at),
    after: algae(mine, at, end),
    photoBefore: tankPhotos.filter((p) => new Date(p.date).getTime() < at).at(-1),
    photoAfter: tankPhotos.filter((p) => new Date(p.date).getTime() >= at && new Date(p.date).getTime() < end).at(-1),
    daysSince: Math.floor((now.getTime() - at) / DAY),
  };
}

/** Verdict court, prudent : on ne conclut qu'avec des bilans des deux côtés et assez de recul. */
export function effectVerdict(e: ChangeEffect): { level: 'ok' | 'warn' | 'info'; text: string } {
  if (e.daysSince < 10) return { level: 'info', text: `Trop tôt pour juger (${e.daysSince} j). Les algues réagissent en 2 à 3 semaines.` };
  if (!e.before.checks || !e.after.checks) return { level: 'info', text: 'Pas assez de bilans visuels avant et après pour comparer.' };
  if (e.after.findings < e.before.findings) return { level: 'ok', text: `Moins d’algues signalées : ${e.before.findings} avant, ${e.after.findings} après.` };
  if (e.after.findings > e.before.findings) return { level: 'warn', text: `Plus d’algues signalées : ${e.before.findings} avant, ${e.after.findings} après.` };
  return { level: 'info', text: `Pas de différence nette : ${e.before.findings} signalement(s) avant comme après.` };
}
