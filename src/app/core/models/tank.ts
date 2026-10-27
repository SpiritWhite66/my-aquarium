import type { Entity } from './entity';

export type TankType = 'planted' | 'community' | 'shrimp' | 'quarantine' | 'nursery' | 'other';

export interface Tank extends Entity {
  name: string;
  type: TankType;
  volumeGross: number; // litres
  volumeNet?: number;
  dimensions?: { l: number; w: number; h: number }; // cm
  startDate: string; // YYYY-MM-DD
  substrate?: string;
  co2: boolean;
  lighting?: { model?: string; photoperiodHours?: number };
  archived: boolean;
  notes?: string;
  coverPhotoId?: string; // photo affichée sur la carte et en tête du bac
  cycling?: boolean; // bac en cours de cyclage (pas encore prêt pour les animaux)
  co2Target?: number; // bulles par minute visées
}
