// Libellés français et mise en forme.

import type {
  FaunaInfo,
  FloraInfo,
  HealthStatus,
  QuantityUnit,
  Species,
  SpeciesKind,
  TankType,
  TaskType,
} from './models';
import { daysBetween, parseIsoDate } from './dates';

export const TANK_TYPES: Record<TankType, string> = {
  planted: 'Planté',
  community: 'Communautaire',
  shrimp: 'Crevettes',
  quarantine: 'Quarantaine',
  nursery: 'Nurserie',
  other: 'Autre',
};

export const KINDS: Record<SpeciesKind, string> = {
  plant: 'Plante',
  fish: 'Poisson',
  shrimp: 'Crevette',
  snail: 'Escargot',
  other: 'Autre',
};

export const UNITS: Record<QuantityUnit, [string, string]> = {
  individual: ['individu', 'individus'],
  stem: ['pied', 'pieds'],
  pot: ['pot', 'pots'],
  portion: ['portion', 'portions'],
  rosette: ['rosette', 'rosettes'],
  cm2: ['cm²', 'cm²'],
};

export const STATUSES: Record<HealthStatus, string> = {
  healthy: 'Bonne',
  sick: 'Malade',
  quarantine: 'Quarantaine',
  removed: 'Retiré',
  dead: 'Mort',
};

export const TASK_TYPES: Record<TaskType, string> = {
  water_change: 'Changement d’eau',
  filter_clean: 'Nettoyage du filtre',
  glass_clean: 'Vitres',
  gravel_vacuum: 'Siphonnage du sol',
  plant_trim: 'Taille des plantes',
  fertilize: 'Fertilisation',
  co2_refill: 'Recharge CO2',
  water_test: 'Test de l’eau',
  custom: 'Autre tâche',
};

export const PLACEMENTS: Record<FloraInfo['placement'], string> = {
  foreground: 'Avant‑plan',
  midground: 'Milieu',
  background: 'Arrière‑plan',
  epiphyte: 'Épiphyte',
  floating: 'Flottante',
};

export const LIGHTS: Record<FloraInfo['light'], string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Forte',
};

export const GROWTHS: Record<FloraInfo['growth'], string> = {
  slow: 'Lente',
  medium: 'Moyenne',
  fast: 'Rapide',
};

export const ZONES: Record<FaunaInfo['zone'], string> = {
  top: 'Surface',
  middle: 'Mi‑hauteur',
  bottom: 'Fond',
  all: 'Partout',
};

export const TEMPERAMENTS: Record<FaunaInfo['temperament'], string> = {
  peaceful: 'Paisible',
  'semi-aggressive': 'Territorial',
  aggressive: 'Agressif',
};

export const DIETS: Record<FaunaInfo['diet'], string> = {
  herbivore: 'Herbivore',
  omnivore: 'Omnivore',
  carnivore: 'Carnivore',
};

export const DIFFICULTIES: Record<NonNullable<Species['difficulty']>, string> = {
  easy: 'Facile',
  medium: 'Moyenne',
  hard: 'Difficile',
};

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export function fmt(n: number | undefined | null): string {
  return n == null || Number.isNaN(n) ? '—' : nf.format(n);
}

export function fmtRange(min: number, max: number, unit = ''): string {
  return `${fmt(min)}–${fmt(max)}${unit ? ' ' + unit : ''}`;
}

export function unitLabel(unit: QuantityUnit, quantity: number): string {
  return UNITS[unit][quantity > 1 ? 1 : 0];
}

export function speciesName(s: Species | undefined): string {
  return s ? (s.commonNames[0] ?? s.scientificName) : 'Espèce inconnue';
}

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtLongDate(d: Date): string {
  return cap(longDate.format(d));
}
export function fmtShortDate(iso: string): string {
  return cap(shortDate.format(iso.length > 10 ? new Date(iso) : parseIsoDate(iso)));
}
export function fmtTime(iso: string): string {
  return time.format(new Date(iso));
}

/** « aujourd'hui », « dans 2 j », « en retard de 3 j ». */
export function dueLabel(nextDue: string, today: string): string {
  const d = daysBetween(today, nextDue);
  if (d === 0) return 'aujourd’hui';
  if (d === 1) return 'demain';
  if (d > 0) return `dans ${d} j`;
  return `en retard de ${-d} j`;
}

/** « il y a 2 j » pour un relevé. */
export function agoLabel(iso: string, today: string): string {
  const d = daysBetween(iso.slice(0, 10), today);
  if (d <= 0) return 'aujourd’hui';
  if (d === 1) return 'hier';
  return `il y a ${d} j`;
}

export function frequencyLabel(days: number): string {
  if (days === 1) return 'Quotidien';
  if (days === 7) return 'Hebdo';
  if (days === 30 || days === 31) return 'Mensuel';
  if (days % 7 === 0) return `Toutes les ${days / 7} sem.`;
  return `Tous les ${days} j`;
}

/** Saisie française : accepte « 6,8 » comme « 6.8 ». */
export function parseNumber(raw: string): number | undefined {
  const v = raw.trim().replace(',', '.');
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
