// Calculs d'aide à la décision : changement d'eau, tendances, cyclage, agenda.
// Fonctions pures, testées dans insights.spec.ts.

import type { Consumable, DailySchedule, DropChecker, Equipment, LightSpec, MaintenanceTask, ParamKey, Range, Tank, WaterTest } from './models';
import { addDays, daysBetween, parseIsoDate, toIsoDate } from './dates';
import { fmt } from './labels';

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

// ---------- CO2 ----------

/**
 * Bulles par minute à partir des instants (ms) où l'utilisateur a tapé à chaque bulle.
 * On mesure les intervalles entre bulles : le premier tap démarre le chrono.
 */
export function bpmFromTaps(taps: number[]): number | undefined {
  if (taps.length < 2) return undefined;
  const span = taps.at(-1)! - taps[0];
  if (span <= 0) return undefined;
  return Math.round(((taps.length - 1) * 60_000) / span);
}

export const DROP_CHECKER: Record<DropChecker, { label: string; detail: string; level: 'ok' | 'warn' | 'danger' }> = {
  blue: { label: 'Bleu', detail: 'CO2 insuffisant (moins de ~15 mg/L) : augmente légèrement le débit.', level: 'warn' },
  green: { label: 'Vert', detail: 'CO2 correct (~30 mg/L).', level: 'ok' },
  yellow: { label: 'Jaune', detail: 'Trop de CO2 (plus de ~40 mg/L) : dangereux pour les poissons, baisse le débit.', level: 'danger' },
};

/** Écart d'une mesure de bulles à la cible : dans la cible à ±15 %. */
export function co2Status(bpm: number, target?: number): 'ok' | 'low' | 'high' | undefined {
  if (!target) return undefined;
  if (bpm < target * 0.85) return 'low';
  if (bpm > target * 1.15) return 'high';
  return 'ok';
}

// ---------- Matériel et consommables ----------

export interface StockAlert {
  level: 'info' | 'warn' | 'danger';
  title: string;
  detail: string;
  kind: 'consumable' | 'equipment';
  id: string;
}

/** Fin de garantie (YYYY-MM-DD) d'un équipement, si connue. */
export function warrantyEnd(e: Pick<Equipment, 'purchaseDate' | 'warrantyMonths'>): string | undefined {
  if (!e.purchaseDate || !e.warrantyMonths) return undefined;
  const d = parseIsoDate(e.purchaseDate);
  d.setMonth(d.getMonth() + e.warrantyMonths);
  return toIsoDate(d);
}

/** Consommables à racheter ou périmés, garanties qui se terminent bientôt. */
export function stockAlerts(consumables: Consumable[], equipment: Equipment[], today: string): StockAlert[] {
  const out: StockAlert[] = [];
  for (const c of consumables) {
    if (c.level === 'empty') out.push({ level: 'warn', title: `${c.name} : vide`, detail: 'À racheter.', kind: 'consumable', id: c.id });
    else if (c.level === 'low') out.push({ level: 'info', title: `${c.name} : bientôt vide`, detail: 'Pense à en racheter.', kind: 'consumable', id: c.id });
    if (c.expiryDate) {
      const days = daysBetween(today, c.expiryDate);
      if (days < 0) {
        const why = c.category === 'test_kit' ? ' Un test périmé donne des valeurs fausses.' : '';
        out.push({ level: c.category === 'test_kit' ? 'danger' : 'warn', title: `${c.name} : périmé`, detail: `Depuis ${-days} j.${why}`, kind: 'consumable', id: c.id });
      } else if (days <= 30) {
        out.push({ level: 'info', title: `${c.name} : périme bientôt`, detail: `Dans ${days} j.`, kind: 'consumable', id: c.id });
      }
    }
  }
  for (const e of equipment) {
    const end = warrantyEnd(e);
    if (!end) continue;
    const days = daysBetween(today, end);
    if (days >= 0 && days <= 30) out.push({ level: 'info', title: `Garantie : ${e.name}`, detail: `Se termine dans ${days} j.`, kind: 'equipment', id: e.id });
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---------- CO2 estimé à partir du KH et du pH ----------

/**
 * Concentration de CO2 dissous (mg/L) d'après l'équilibre carbonate : CO2 ≈ 3 × KH × 10^(7 − pH).
 * Valable si le KH vient des carbonates (faussé par les tampons phosphatés, la tourbe, les tanins).
 * Le pH doit être mesuré pendant l'injection, idéalement en fin de matinée d'éclairage.
 */
export function co2FromKhPh(kh: number, ph: number): number | undefined {
  if (!(kh > 0) || !(ph > 0)) return undefined;
  return Math.round(3 * kh * 10 ** (7 - ph) * 10) / 10;
}

export interface Co2Advice {
  mgL: number;
  level: 'ok' | 'warn' | 'danger';
  verdict: 'very_low' | 'low' | 'ok' | 'high' | 'very_high';
  title: string;
  detail: string;
  /** Débit conseillé en bulles/min (si le débit actuel est connu), par paliers de 20 % max. */
  suggestedBpm?: number;
}

/** Zone visée pour un bac planté : 20 à 30 mg/L. */
export const CO2_TARGET = { min: 20, max: 30 };

export function co2Advice(mgL: number, currentBpm?: number): Co2Advice {
  // Ajustement progressif : on vise le milieu de la zone, sans dépasser ±20 % par étape.
  const step = (factor: number) => (currentBpm ? Math.max(1, Math.round(currentBpm * factor)) : undefined);
  const ratio = 25 / Math.max(mgL, 1);
  if (mgL < 10)
    return { mgL, level: 'warn', verdict: 'very_low', title: 'CO2 très insuffisant',
      detail: 'Les plantes en manquent fortement. Augmente le débit par paliers de 20 % et remesure le pH 2 h après chaque réglage.', suggestedBpm: step(1.2) };
  if (mgL < CO2_TARGET.min)
    return { mgL, level: 'warn', verdict: 'low', title: 'CO2 un peu faible',
      detail: 'Augmente légèrement le débit, puis remesure le pH en fin de matinée d’éclairage.', suggestedBpm: step(Math.min(1.2, ratio)) };
  if (mgL <= 35)
    return { mgL, level: 'ok', verdict: 'ok', title: 'CO2 correct', detail: 'Garde ce débit.', suggestedBpm: currentBpm };
  if (mgL <= 45)
    return { mgL, level: 'warn', verdict: 'high', title: 'CO2 un peu élevé',
      detail: 'Baisse légèrement le débit et surveille les poissons (respiration en surface).', suggestedBpm: step(Math.max(0.85, ratio)) };
  return { mgL, level: 'danger', verdict: 'very_high', title: 'Trop de CO2',
    detail: 'Danger pour les poissons et crevettes : baisse nettement le débit et augmente l’agitation de surface.', suggestedBpm: step(0.7) };
}

/**
 * Dernier couple KH + pH exploitable : pris dans le même relevé, ou le pH le plus récent
 * avec un KH mesuré dans les 7 jours (le KH varie lentement).
 */
export function latestKhPh(tests: WaterTest[]): { kh: number; ph: number; date: string } | undefined {
  for (let i = tests.length - 1; i >= 0; i--) {
    const ph = tests[i].values.ph;
    if (ph == null) continue;
    const t = new Date(tests[i].date).getTime();
    for (let j = i; j >= 0; j--) {
      const kh = tests[j].values.kh;
      if (kh == null) continue;
      if (t - new Date(tests[j].date).getTime() <= 7 * 86_400_000) return { kh, ph, date: tests[i].date };
      break;
    }
  }
  return undefined;
}

// ---------- Contrôles du matériel d'un bac ----------

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Durée d'une plage horaire en heures (gère le passage de minuit). */
export function scheduleHours(s: DailySchedule): number {
  let d = minutes(s.off) - minutes(s.on);
  if (d <= 0) d += 24 * 60;
  return Math.round((d / 60) * 10) / 10;
}

/** Durée d'éclairage effective : plage moins la sieste éventuelle. */
export function photoperiod(light: LightSpec): number | undefined {
  if (!light.schedule) return undefined;
  const siesta = light.siesta ? scheduleHours(light.siesta) : 0;
  return Math.max(0, Math.round((scheduleHours(light.schedule) - siesta) * 10) / 10);
}

export interface GearCheck {
  level: 'ok' | 'info' | 'warn';
  title: string;
  detail: string;
}

/** Vérifications croisées du matériel d'un bac : éclairage, brassage, synchronisation CO2/lumière. */
export function gearChecks(tank: Tank, gear: Equipment[]): GearCheck[] {
  const out: GearCheck[] = [];
  const volume = tank.volumeNet ?? tank.volumeGross;
  const lights = gear.filter((g) => g.type === 'light' && g.light);
  const light = lights.find((l) => l.light?.schedule)?.light;

  if (light) {
    const h = photoperiod(light)!;
    if (h > 9) out.push({ level: 'warn', title: `Éclairage long : ${fmt(h)} h par jour`, detail: 'Au-delà de 8 à 9 h, les algues profitent du surplus de lumière. Vise 7 à 8 h, surtout sur un bac récent.' });
    else if (h < 6) out.push({ level: 'info', title: `Éclairage court : ${fmt(h)} h par jour`, detail: 'Les plantes exigeantes peuvent manquer de lumière.' });
    else out.push({ level: 'ok', title: `Éclairage : ${fmt(h)} h par jour`, detail: 'Durée adaptée à un bac planté.' });
    if (tank.cycling && (light.intensityPct ?? 100) > 60)
      out.push({ level: 'info', title: 'Intensité élevée pendant le cyclage', detail: 'Pendant les premières semaines, une intensité réduite (40 à 60 %) limite les algues.' });
  }

  const flow = gear.filter((g) => g.type === 'filter' || g.type === 'pump').reduce((s, g) => s + (g.filter?.flowLh ?? 0), 0);
  if (flow && volume) {
    const turns = Math.round((flow / volume) * 10) / 10;
    if (turns < 4) out.push({ level: 'warn', title: `Brassage faible : ${fmt(turns)} × le volume par heure`, detail: 'Moins de 4 fois le volume par heure : zones mortes, CO2 et engrais mal répartis. Le débit réel est souvent 30 à 50 % inférieur à celui annoncé.' });
    else out.push({ level: 'ok', title: `Brassage : ${fmt(turns)} × le volume par heure`, detail: tank.type === 'planted' ? 'Pour un bac planté avec CO2, 8 à 10 fois est idéal.' : 'Correct.' });
  }

  const co2 = gear.find((g) => g.type === 'co2' && g.co2?.schedule)?.co2;
  if (co2?.schedule && light?.schedule) {
    const lead = minutes(light.schedule.on) - minutes(co2.schedule.on);
    const stopBefore = minutes(light.schedule.off) - minutes(co2.schedule.off);
    if (lead < 30) out.push({ level: 'warn', title: 'CO2 démarré trop tard', detail: 'Allume le CO2 1 à 2 h avant la lumière pour que la concentration soit bonne dès l’allumage.' });
    if (stopBefore < 0) out.push({ level: 'warn', title: 'CO2 encore actif après l’extinction', detail: 'Sans lumière, les plantes n’utilisent plus le CO2 : coupe-le environ 1 h avant l’extinction.' });
    if (lead >= 30 && stopBefore >= 0) out.push({ level: 'ok', title: 'CO2 synchronisé avec la lumière', detail: `Démarre ${fmt(Math.round(lead / 6) / 10)} h avant l’allumage.` });
  } else if (tank.co2 && co2 && !co2.schedule && !co2.solenoid) {
    out.push({ level: 'info', title: 'CO2 sans électrovanne', detail: 'Injecté jour et nuit : le pH baisse la nuit. Une électrovanne programmée est plus sûre pour les animaux.' });
  }

  const heater = gear.find((g) => g.type === 'heater' && g.heater?.powerW)?.heater;
  if (heater?.powerW && volume && heater.powerW < volume * 0.5)
    out.push({ level: 'info', title: 'Chauffage peut-être juste', detail: `${heater.powerW} W pour ${volume} L : compte environ 1 W par litre dans une pièce fraîche.` });
  return out;
}
