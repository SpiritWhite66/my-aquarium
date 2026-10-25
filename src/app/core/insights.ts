// Calculs d'aide à la décision : changement d'eau, tendances, cyclage, agenda.
// Fonctions pures, testées dans insights.spec.ts.

import type { MaintenanceTask, ParamKey, Range, Tank, WaterTest } from './models';
import { addDays } from './dates';

// ---------- Changement d'eau ----------

/** Pourcentage indiqué dans le libellé d'une tâche (« Changement d’eau 30 % »), sinon 30. */
export function percentFromLabel(label: string, fallback = 30): number {
  const m = /(\d{1,3})\s*%/.exec(label);
  const n = m ? Number(m[1]) : fallback;
  return Math.min(100, Math.max(1, n));
}

/**
 * Concentration après un changement d'eau : la part changée est remplacée
 * par de l'eau neuve à `tapValue` (0 par défaut pour les nitrates d'une eau osmosée ou du robinet traitée).
 */
export function afterWaterChange(value: number, fraction: number, tapValue = 0): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.round((value * (1 - f) + tapValue * f) * 10) / 10;
}

// ---------- Tendances ----------

export interface Trend {
  perWeek: number; // variation par semaine
  last: number;
  /** Jours avant de sortir de la plage (si la tendance continue), sinon undefined. */
  daysToLimit?: number;
  limit?: 'max' | 'min';
}

/**
 * Tendance linéaire (moindres carrés) d'un paramètre sur les relevés récents.
 * Il faut au moins 3 mesures sur la période ; la tendance n'est retournée que si elle est nette.
 */
export function trendOf(tests: WaterTest[], key: ParamKey, range?: Range, windowDays = 60, now = Date.now()): Trend | undefined {
  const from = now - windowDays * 86_400_000;
  const pts = tests
    .filter((t) => t.values[key] != null && new Date(t.date).getTime() >= from)
    .map((t) => ({ x: new Date(t.date).getTime() / 86_400_000, y: t.values[key]! }));
  if (pts.length < 3) return undefined;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return undefined;
  const slopePerDay = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  const last = pts.at(-1)!.y;
  const perWeek = slopePerDay * 7;

  // Tendance « nette » : sur 4 semaines, elle déplacerait la valeur d'au moins 20 % de la plage
  // (ou de 10 % de la valeur actuelle sans plage).
  const scale = range ? Math.max(range.max - range.min, 0.1) : Math.max(Math.abs(last), 1);
  if (Math.abs(perWeek * 4) < scale * (range ? 0.2 : 0.1)) return undefined;

  const trend: Trend = { perWeek: Math.round(perWeek * 10) / 10, last };
  if (range && slopePerDay > 0 && last <= range.max) {
    trend.daysToLimit = Math.max(0, Math.ceil((range.max - last) / slopePerDay));
    trend.limit = 'max';
  } else if (range && slopePerDay < 0 && last >= range.min) {
    trend.daysToLimit = Math.max(0, Math.ceil((last - range.min) / -slopePerDay));
    trend.limit = 'min';
  }
  return trend;
}

// ---------- Cyclage ----------

export type CyclingPhase = 'no_data' | 'ammonia' | 'nitrite' | 'waiting' | 'done';

export const CYCLING_LABELS: Record<CyclingPhase, { title: string; detail: string }> = {
  no_data: { title: 'Démarrage', detail: 'Mesure NH4, NO2 et NO3 deux fois par semaine pour suivre le cyclage.' },
  ammonia: { title: 'Pic d’ammonium', detail: 'Les premières bactéries s’installent. Ne pas ajouter d’animaux.' },
  nitrite: { title: 'Pic de nitrites', detail: 'L’ammonium est transformé en nitrites, très toxiques. Encore un peu de patience.' },
  waiting: { title: 'En cours', detail: 'Continue les mesures : le bac est prêt quand NH4 et NO2 restent à zéro avec des nitrates présents.' },
  done: { title: 'Cyclage terminé', detail: 'NH4 et NO2 à zéro sur deux mesures et nitrates présents : tu peux introduire les premiers animaux, progressivement.' },
};

/** Phase du cyclage d'après les derniers relevés (du plus ancien au plus récent). */
export function cyclingPhase(tests: WaterTest[]): CyclingPhase {
  const withN = tests.filter((t) => t.values.nh4 != null || t.values.no2 != null || t.values.no3 != null);
  const last = withN.at(-1);
  if (!last) return 'no_data';
  const nh4 = last.values.nh4 ?? 0;
  const no2 = last.values.no2 ?? 0;
  if (no2 > 0.1) return 'nitrite';
  if (nh4 > 0.25) return 'ammonia';
  const clean = (t: WaterTest) => t.values.nh4 != null && t.values.no2 != null && t.values.nh4 <= 0.25 && t.values.no2 <= 0.1;
  const lastTwo = withN.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every(clean) && (last.values.no3 ?? 0) > 0) return 'done';
  return 'waiting';
}

// ---------- Agenda (.ics) ----------

const icsDate = (iso: string) => iso.slice(0, 10).replaceAll('-', '');
const icsEscape = (s: string) => s.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

/** Rappels d'entretien au format iCalendar, avec répétition et alarme à 9 h. */
export function tasksToIcs(tasks: MaintenanceTask[], tanks: Tank[], now = new Date()): string {
  const names = new Map(tanks.map((t) => [t.id, t.name]));
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//my-aquarium//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Aquariums'];
  for (const t of tasks) {
    const tank = names.get(t.tankId);
    if (!t.active || !tank) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@my-aquarium`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(t.nextDue)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(t.nextDue, 1))}`,
      `RRULE:FREQ=DAILY;INTERVAL=${t.everyDays}`,
      `SUMMARY:${icsEscape(`${t.label} — ${tank}`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(t.label)}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
