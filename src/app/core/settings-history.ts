// Historique des réglages du matériel (intensité et horaires d'éclairage, CO2, chauffage, débit)
// et mise en regard avec les algues signalées avant et après chaque changement.

import type { DailySchedule, Equipment, Observation, Photo, SettingChange } from './models';
import { fmt } from './labels';
import { photoperiod } from './insights';
import { must } from './assert';

type Field = SettingChange['field'];

const sched = (s?: DailySchedule) => (s?.on && s.off ? `${s.on}–${s.off}` : undefined);
const pct = (n?: number) => (n == null ? undefined : `${fmt(n)} %`);
const hours = (n?: number) => (n == null ? undefined : `${fmt(n)} h`);

/** Réglages suivis : libellé et lecture de la valeur affichable. */
const TRACKED: {
  field: Field;
  label: string;
  read: (e: Partial<Equipment>) => string | undefined;
}[] = [
  { field: 'light.intensityPct', label: 'Intensité', read: (e) => pct(e.light?.intensityPct) },
  { field: 'light.schedule', label: 'Horaires d’éclairage', read: (e) => sched(e.light?.schedule) },
  { field: 'light.siesta', label: 'Sieste', read: (e) => sched(e.light?.siesta) },
  {
    field: 'light.photoperiod',
    label: 'Durée d’éclairage',
    read: (e) => hours(e.light ? photoperiod(e.light) : undefined),
  },
  {
    field: 'light.rampMinutes',
    label: 'Lever / coucher',
    read: (e) => (e.light?.rampMinutes == null ? undefined : `${e.light.rampMinutes} min`),
  },
  { field: 'co2.schedule', label: 'Horaires CO2', read: (e) => sched(e.co2?.schedule) },
  {
    field: 'heater.setpointC',
    label: 'Consigne chauffage',
    read: (e) => (e.heater?.setpointC == null ? undefined : `${fmt(e.heater.setpointC)} °C`),
  },
  {
    field: 'filter.flowLh',
    label: 'Débit du filtre',
    read: (e) => (e.filter?.flowLh == null ? undefined : `${e.filter.flowLh} L/h`),
  },
];

export const SETTING_LABELS = Object.fromEntries(TRACKED.map((t) => [t.field, t.label])) as Record<
  Field,
  string
>;

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

interface AlgaeWindow {
  /** Niveau d'algues moyen sur la période, de 0 (aucune) à 3 (beaucoup). */
  level: number;
  /** Notes d'algues et bilans visuels faits sur la période (0 : rien pour comparer). */
  checks: number;
}

/**
 * Niveau d'algues d'une observation, de 0 à 3 : la note manuelle si elle existe,
 * sinon la gravité la plus forte parmi les algues signalées par un bilan visuel.
 */
export function algaeScore(o: Observation): number {
  if (o.algaeLevel != null) return o.algaeLevel;
  const algae = o.findings.filter((f) => f.category === 'algae' && !f.resolved);
  if (!algae.length) return 0;
  return Math.max(
    ...algae.map((f) => (f.severity === 'danger' ? 3 : f.severity === 'warn' ? 2 : 1)),
  );
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
  const total = inWindow.reduce((n, o) => n + algaeScore(o), 0);
  return {
    checks: inWindow.length,
    level: inWindow.length ? Math.round((total / inWindow.length) * 10) / 10 : 0,
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
  const end = Math.min(
    at + windowDays * DAY,
    nextChangeDate ? new Date(nextChangeDate).getTime() : Infinity,
    now.getTime() + 1,
  );
  const mine = observations.filter((o) => o.tankId === change.tankId);
  const tankPhotos = photos
    .filter((p) => p.tankId === change.tankId && !p.inhabitantId)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    before: algae(mine, at - windowDays * DAY, at),
    after: algae(mine, at, end),
    photoBefore: tankPhotos.filter((p) => new Date(p.date).getTime() < at).at(-1),
    photoAfter: tankPhotos
      .filter((p) => new Date(p.date).getTime() >= at && new Date(p.date).getTime() < end)
      .at(-1),
    daysSince: Math.floor((now.getTime() - at) / DAY),
  };
}

/** Verdict court, prudent : on ne conclut qu'avec des bilans des deux côtés et assez de recul. */
export function effectVerdict(e: ChangeEffect): { level: 'ok' | 'warn' | 'info'; text: string } {
  if (e.daysSince < 10)
    return {
      level: 'info',
      text: `Trop tôt pour juger (${e.daysSince} j). Les algues réagissent en 2 à 3 semaines.`,
    };
  if (!e.before.checks || !e.after.checks)
    return { level: 'info', text: 'Pas assez de notes d’algues avant et après pour comparer.' };
  const lv = (n: number) => `${fmt(n)}/3`;
  const diff = e.after.level - e.before.level;
  if (diff <= -0.5)
    return {
      level: 'ok',
      text: `Moins d’algues : niveau moyen ${lv(e.before.level)} avant, ${lv(e.after.level)} après.`,
    };
  if (diff >= 0.5)
    return {
      level: 'warn',
      text: `Plus d’algues : niveau moyen ${lv(e.before.level)} avant, ${lv(e.after.level)} après.`,
    };
  return {
    level: 'info',
    text: `Pas de différence nette : niveau moyen ${lv(e.before.level)} avant, ${lv(e.after.level)} après.`,
  };
}

export interface SettingGroup extends SettingChange {
  /** Clé stable : matériel + date d'enregistrement. */
  key: string;
  /** Réglages modifiés ensemble (même matériel, même date). */
  changes: SettingChange[];
  effect: ChangeEffect;
  verdict: ReturnType<typeof effectVerdict>;
}

/**
 * Changements de réglages d'un bac regroupés par enregistrement (un matériel, une date), du plus récent
 * au plus ancien, chacun avec son effet sur les algues. L'« après » s'arrête au changement suivant
 * du même réglage sur le même matériel.
 */
export function groupSettingChanges(
  changes: SettingChange[],
  tankId: string,
  observations: Observation[],
  photos: Photo[],
  now: Date,
): SettingGroup[] {
  const groups = new Map<string, SettingChange[]>();
  for (const c of changes.filter((c) => c.tankId === tankId)) {
    const key = c.equipmentId + c.date;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const list = [...groups.entries()].map(([key, changes]) => ({
    key,
    changes,
    ...must(changes[0]),
  }));
  return list
    .map((g) => {
      const next = list.find(
        (o) =>
          o.equipmentId === g.equipmentId &&
          o.date > g.date &&
          o.changes.some((c) => g.changes.some((d) => d.field === c.field)),
      );
      const effect = changeEffect(must(g.changes[0]), observations, photos, now, next?.date);
      return { ...g, effect, verdict: effectVerdict(effect) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
