import type { Entity } from './entity';

export type FindingCategory =
  | 'algae'
  | 'fish_health'
  | 'invertebrate_health'
  | 'plant_health'
  | 'water_clarity'
  | 'equipment'
  | 'aquascape'
  | 'other';

interface Finding {
  category: FindingCategory;
  severity: 'info' | 'warn' | 'danger';
  title: string;
  detail?: string;
  scientificName?: string;
  speciesId?: string; // rattaché au catalogue à l'import
  likelyCause?: string;
  advice?: string[];
  confidence: 'high' | 'medium' | 'low';
  resolved?: boolean;
}

export interface Observation extends Entity {
  tankId: string;
  date: string; // ISO datetime
  overall: 'good' | 'watch' | 'problem';
  summary?: string;
  findings: Finding[];
  source?: string; // description de la photo
  warnings?: string[];
  /** Note rapide saisie à la main : 0 aucune, 1 un peu, 2 moyen, 3 beaucoup. */
  algaeLevel?: AlgaeLevel;
  algaeTypes?: string[];
  manual?: boolean;
}

export type AlgaeLevel = 0 | 1 | 2 | 3;
