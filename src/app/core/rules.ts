// Règles métier : plages idéales, état des relevés, compatibilité des espèces.
// Fonctions pures, sans dépendance à Angular, pour être testées et réutilisées par le futur serveur MCP.

import type { Inhabitant, ParamKey, Range, Species, Tank, WaterTest } from './models';
import { must } from './assert';

export type Level = 'ok' | 'warn' | 'danger';

export interface ParamDef {
  key: ParamKey;
  label: string;
  short: string;
  unit: string;
  /** Plage par défaut quand aucune espèce n'en impose. */
  fallback?: Range;
  /** Un dépassement est dangereux (toxique) et pas seulement à surveiller. */
  toxic?: boolean;
  /** Fourni par les fiches espèces. */
  fromSpecies?: boolean;
}

export const PARAMS: ParamDef[] = [
  {
    key: 'temp',
    label: 'Température',
    short: 'Temp.',
    unit: '°C',
    fallback: { min: 22, max: 26 },
    fromSpecies: true,
  },
  {
    key: 'ph',
    label: 'pH',
    short: 'pH',
    unit: '',
    fallback: { min: 6, max: 7.5 },
    fromSpecies: true,
  },
  {
    key: 'gh',
    label: 'Dureté GH',
    short: 'GH',
    unit: '°d',
    fallback: { min: 4, max: 12 },
    fromSpecies: true,
  },
  {
    key: 'kh',
    label: 'Dureté KH',
    short: 'KH',
    unit: '°d',
    fallback: { min: 2, max: 8 },
    fromSpecies: true,
  },
  {
    key: 'no2',
    label: 'Nitrites NO2',
    short: 'NO2',
    unit: 'mg/L',
    fallback: { min: 0, max: 0.1 },
    toxic: true,
  },
  { key: 'no3', label: 'Nitrates NO3', short: 'NO3', unit: 'mg/L', fallback: { min: 0, max: 25 } },
  {
    key: 'nh4',
    label: 'Ammonium NH4',
    short: 'NH4',
    unit: 'mg/L',
    fallback: { min: 0, max: 0.2 },
    toxic: true,
  },
  {
    key: 'po4',
    label: 'Phosphates PO4',
    short: 'PO4',
    unit: 'mg/L',
    fallback: { min: 0, max: 1.5 },
  },
  { key: 'fe', label: 'Fer', short: 'Fe', unit: 'mg/L', fallback: { min: 0, max: 0.5 } },
  { key: 'k', label: 'Potassium K', short: 'K', unit: 'mg/L' },
  { key: 'mg', label: 'Magnésium Mg', short: 'Mg', unit: 'mg/L' },
  { key: 'co2', label: 'CO2', short: 'CO2', unit: 'mg/L', fallback: { min: 0, max: 30 } },
  { key: 'conductivity', label: 'Conductivité', short: 'Cond.', unit: 'µS/cm' },
];

export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<
  ParamKey,
  ParamDef
>;

/** Paramètres affichés par défaut (relevé et onglet Eau). */
export const MAIN_PARAMS: ParamKey[] = ['temp', 'ph', 'gh', 'kh', 'no2', 'no3', 'nh4', 'po4'];

/** Paramètres secondaires (engrais, conductivité) : saisis à la demande, affichés dès qu'ils ont été mesurés. */
export const EXTRA_PARAMS: ParamKey[] = ['fe', 'k', 'mg', 'conductivity'];

/** Paramètres principaux, plus les secondaires présents dans au moins un relevé. */
export function measuredParams(tests: { values: Partial<Record<ParamKey, number>> }[]): ParamKey[] {
  return [...MAIN_PARAMS, ...EXTRA_PARAMS.filter((k) => tests.some((t) => t.values[k] != null))];
}

export interface IdealRange extends Range {
  /** Espèces qui ont contribué à la plage (vide = plage par défaut). */
  from: Species[];
  /** Les plages des espèces ne se recouvrent pas. */
  conflict: boolean;
}

/** Intersection des plages des espèces vivantes du bac, ou plage par défaut. */
export function idealRange(key: ParamKey, species: Species[], tank?: Tank): IdealRange | undefined {
  const def = PARAM_BY_KEY[key];
  let fallback = def.fallback;
  if (key === 'no3' && tank?.type === 'planted') fallback = { min: 5, max: 25 };
  if (key === 'po4' && tank?.type === 'planted') fallback = { min: 0.1, max: 1.5 };
  // Repères usuels pour un bac planté fertilisé.
  if (key === 'fe' && tank?.type === 'planted') fallback = { min: 0.05, max: 0.5 };
  if (key === 'k' && tank?.type === 'planted') fallback = { min: 5, max: 30 };
  if (key === 'mg' && tank?.type === 'planted') fallback = { min: 5, max: 20 };

  if (!def.fromSpecies) return fallback ? { ...fallback, from: [], conflict: false } : undefined;

  const ranged = species.filter((s) => s[key as 'temp' | 'ph' | 'gh' | 'kh']);
  if (!ranged.length) return fallback ? { ...fallback, from: [], conflict: false } : undefined;

  let min = -Infinity;
  let max = Infinity;
  for (const s of ranged) {
    const rg = must(s[key as 'temp' | 'ph' | 'gh' | 'kh']);
    min = Math.max(min, rg.min);
    max = Math.min(max, rg.max);
  }
  if (min > max) {
    // Pas de recouvrement : on affiche la zone « la moins pire » entre les deux bornes.
    return { min: max, max: min, from: ranged, conflict: true };
  }
  return { min, max, from: ranged, conflict: false };
}

export function levelOf(key: ParamKey, value: number, range?: Range): Level {
  if (!range) return 'ok';
  if (value >= range.min && value <= range.max) return 'ok';
  if (PARAM_BY_KEY[key].toxic && value > range.max) return 'danger';
  const span = Math.max(range.max - range.min, 0.1);
  const off = value < range.min ? range.min - value : value - range.max;
  return off > span * 0.5 ? 'danger' : 'warn';
}

export function worst(levels: Level[]): Level {
  if (levels.includes('danger')) return 'danger';
  if (levels.includes('warn')) return 'warn';
  return 'ok';
}

export interface ParamAlert {
  key: ParamKey;
  value: number;
  range: Range;
  level: Level;
  direction: 'high' | 'low';
}

/** Valeurs hors plage d'un relevé. */
export function testAlerts(
  test: WaterTest | undefined,
  species: Species[],
  tank: Tank,
): ParamAlert[] {
  if (!test) return [];
  const out: ParamAlert[] = [];
  for (const [k, value] of Object.entries(test.values) as [ParamKey, number | undefined][]) {
    if (value == null) continue;
    const range = idealRange(k, species, tank);
    if (!range) continue;
    const level = levelOf(k, value, range);
    if (level !== 'ok')
      out.push({ key: k, value, range, level, direction: value > range.max ? 'high' : 'low' });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}

// ---------- Compatibilité ----------

export interface Issue {
  level: Level;
  title: string;
  detail: string;
  speciesIds: string[];
}

const nameOf = (s: Species) => s.commonNames[0] ?? s.scientificName;
const list = (xs: Species[]) => {
  const names = xs.map(nameOf);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`
    : (names[0] ?? '');
};

export function isAlive(i: Inhabitant): boolean {
  return i.status !== 'dead' && i.status !== 'removed';
}

/**
 * Problèmes de cohabitation dans un bac.
 * `members` associe chaque espèce présente à sa quantité.
 */
export function compatibilityIssues(
  tank: Tank,
  members: { species: Species; quantity: number }[],
): Issue[] {
  const issues: Issue[] = [];
  const species = members.map((m) => m.species);
  const plants = species.filter((s) => s.kind === 'plant');
  const shrimps = species.filter((s) => s.kind === 'shrimp');
  const snails = species.filter((s) => s.kind === 'snail');
  // Regroupés en une seule alerte pour ne pas répéter le même conseil.
  const fryPredators: Species[] = [];

  for (const key of ['temp', 'ph', 'gh', 'kh'] as const) {
    const range = idealRange(key, species, tank);
    if (range?.conflict) {
      issues.push({
        level: 'warn',
        title: `${PARAM_BY_KEY[key].short} incompatibles`,
        detail: `Les plages de ${list(range.from)} ne se recouvrent pas.`,
        speciesIds: range.from.map((s) => s.id),
      });
    }
  }

  for (const m of members) {
    const s = m.species;
    const f = s.fauna;
    if (f?.eatsPlants && plants.length) {
      issues.push({
        level: 'warn',
        title: `${nameOf(s)} mange les plantes`,
        detail: `${list(plants)} ${plants.length > 1 ? 'sont menacées' : 'est menacée'}.`,
        speciesIds: [s.id, ...plants.map((p) => p.id)],
      });
    }
    if (f?.predation?.includes('shrimp') && shrimps.length) {
      issues.push({
        level: 'warn',
        title: `${nameOf(s)} chasse les crevettes`,
        detail: `${list(shrimps)} risquent d'être mangées.`,
        speciesIds: [s.id, ...shrimps.map((p) => p.id)],
      });
    } else if (f?.predation?.includes('shrimp_fry') && shrimps.length) {
      fryPredators.push(s);
    }
    if (f?.predation?.includes('snails') && snails.length) {
      issues.push({
        level: 'warn',
        title: `${nameOf(s)} mange les escargots`,
        detail: `${list(snails)} sont menacés.`,
        speciesIds: [s.id, ...snails.map((p) => p.id)],
      });
    }
    if (f?.minGroup && f.minGroup > 1 && m.quantity < f.minGroup) {
      issues.push({
        level: 'warn',
        title: `Groupe trop petit : ${nameOf(s)}`,
        detail: `${m.quantity} individu${m.quantity > 1 ? 's' : ''}, au moins ${f.minGroup} conseillés.`,
        speciesIds: [s.id],
      });
    }
    const volume = tank.volumeNet ?? tank.volumeGross;
    if (f?.minTankLiters && volume < f.minTankLiters) {
      issues.push({
        level: 'warn',
        title: `Bac trop petit pour ${nameOf(s)}`,
        detail: `${volume} L, au moins ${f.minTankLiters} L conseillés.`,
        speciesIds: [s.id],
      });
    }
    if (s.flora?.co2 === 'required' && !tank.co2) {
      issues.push({
        level: 'warn',
        title: `${nameOf(s)} a besoin de CO2`,
        detail: 'Le bac n’a pas d’injection de CO2.',
        speciesIds: [s.id],
      });
    }
  }
  const fauna = species.filter((s) => s.kind !== 'plant');
  if (tank.cycling && fauna.length) {
    issues.push({
      level: 'danger',
      title: 'Animaux dans un bac en cyclage',
      detail: `${list(fauna)} ${fauna.length > 1 ? 'sont exposés' : 'est exposé'} aux pics d’ammonium et de nitrites. Attends la fin du cyclage ou surveille de très près.`,
      speciesIds: fauna.map((s) => s.id),
    });
  }
  if (fryPredators.length) {
    issues.push({
      level: 'warn',
      title: `${list(fryPredators)} ${fryPredators.length > 1 ? 'mangent' : 'mange'} les jeunes crevettes`,
      detail:
        'Les adultes s’en sortent bien. Prévoir des mousses ou des plantes denses comme abri.',
      speciesIds: [...fryPredators.map((p) => p.id), ...shrimps.map((p) => p.id)],
    });
  }
  return issues;
}

/** Problèmes provoqués par l'ajout d'une espèce (ceux qui n'existaient pas avant). */
export function issuesIfAdded(
  tank: Tank,
  members: { species: Species; quantity: number }[],
  candidate: Species,
  quantity = 1,
): Issue[] {
  const before = new Set(compatibilityIssues(tank, members).map((i) => i.title + i.detail));
  const existing = members.find((m) => m.species.id === candidate.id);
  const next = existing
    ? members.map((m) => (m === existing ? { ...m, quantity: m.quantity + quantity } : m))
    : [...members, { species: candidate, quantity }];
  return compatibilityIssues(tank, next).filter(
    (i) => !before.has(i.title + i.detail) && i.speciesIds.includes(candidate.id),
  );
}
