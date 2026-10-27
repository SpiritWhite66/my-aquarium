import type { Entity } from './entity';

export type SpeciesKind = 'fish' | 'shrimp' | 'snail' | 'plant' | 'other';

export interface Range {
  min: number;
  max: number;
}

type Predation = 'shrimp_fry' | 'shrimp' | 'snails' | 'small_fish';

export interface FaunaInfo {
  adultSizeCm: number;
  minGroup?: number;
  minTankLiters?: number;
  temperament: 'peaceful' | 'semi-aggressive' | 'aggressive';
  zone: 'top' | 'middle' | 'bottom' | 'all';
  diet: 'herbivore' | 'omnivore' | 'carnivore';
  eatsPlants?: boolean;
  predation?: Predation[];
  role?: string; // « Nettoyeuse », « Vitres »…
}

export interface FloraInfo {
  light: 'low' | 'medium' | 'high';
  co2: 'none' | 'beneficial' | 'required';
  growth: 'slow' | 'medium' | 'fast';
  placement: 'foreground' | 'midground' | 'background' | 'epiphyte' | 'floating';
  form?: string; // tige, rosette, rhizome, mousse…
  propagation: string[];
  maxHeightCm?: number;
}

export interface Species extends Entity {
  kind: SpeciesKind;
  scientificName: string;
  commonNames: string[];
  source: 'builtin' | 'custom';
  /** Fiche du catalogue intégré que cette fiche personnelle remplace. */
  overrides?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  gbifKey?: number;
  wikidataId?: string;
  imageUrl?: string;
  temp?: Range;
  ph?: Range;
  gh?: Range;
  kh?: Range;
  fauna?: FaunaInfo;
  flora?: FloraInfo;
  notes?: string;
}

/** État de la synchronisation du catalogue en ligne (une ligne par type de fiche). */
export interface RefMeta {
  id: string;
  /** Date de modification la plus récente reçue du serveur : point de reprise de la prochaine mise à jour. */
  since: string;
  /** Date de la dernière synchronisation réussie. */
  syncedAt: string;
}
