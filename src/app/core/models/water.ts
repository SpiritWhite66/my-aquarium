import type { Entity } from './entity';

export type ParamKey =
  | 'temp'
  | 'ph'
  | 'gh'
  | 'kh'
  | 'no2'
  | 'no3'
  | 'nh4'
  | 'po4'
  | 'fe'
  | 'k'
  | 'mg'
  | 'co2'
  | 'conductivity';

export interface WaterTest extends Entity {
  tankId: string;
  date: string; // ISO datetime
  values: Partial<Record<ParamKey, number>>;
  method?: 'strips' | 'drops' | 'probe';
  note?: string;
}
