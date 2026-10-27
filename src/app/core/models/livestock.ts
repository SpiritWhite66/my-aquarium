import type { Entity } from './entity';

export type QuantityUnit = 'individual' | 'stem' | 'pot' | 'portion' | 'rosette' | 'cm2';
export type HealthStatus = 'healthy' | 'sick' | 'quarantine' | 'removed' | 'dead';

export interface Inhabitant extends Entity {
  tankId: string;
  speciesId: string;
  quantity: number;
  approximate?: boolean; // « ~30 »
  unit: QuantityUnit;
  addedDate: string;
  origin?: string;
  price?: number;
  status: HealthStatus;
  placementNote?: string;
}

export type InhabitantEventType =
  'added' | 'birth' | 'death' | 'disease' | 'treatment' | 'trim' | 'propagated' | 'moved' | 'note';

export interface InhabitantEvent extends Entity {
  inhabitantId: string;
  tankId: string;
  date: string;
  type: InhabitantEventType;
  quantityDelta?: number;
  note?: string;
}
