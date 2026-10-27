import type { Entity } from './entity';

export type DropChecker = 'blue' | 'green' | 'yellow';

export interface Co2Reading extends Entity {
  tankId: string;
  date: string; // ISO datetime
  bubblesPerMinute?: number;
  dropChecker?: DropChecker;
  /** pH avant l'injection de CO2 (ou eau dégazée) et pH en fin d'éclairage : mesure du décrochage. */
  phBefore?: number;
  phAfter?: number;
  phBeforeTime?: string; // HH:MM
  phAfterTime?: string; // HH:MM
  note?: string;
}
