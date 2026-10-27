import type { Entity } from './entity';

export const PARAM_KEYS = [
  'temp',
  'ph',
  'gh',
  'kh',
  'no2',
  'no3',
  'nh4',
  'po4',
  'fe',
  'k',
  'mg',
  'co2',
  'conductivity',
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export interface WaterTest extends Entity {
  tankId: string;
  date: string; // ISO datetime
  values: Partial<Record<ParamKey, number>>;
  method?: 'strips' | 'drops' | 'probe';
  note?: string;
}
