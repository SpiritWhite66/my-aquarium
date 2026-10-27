import type { Entity } from './entity';

export type TaskType =
  | 'water_change'
  | 'filter_clean'
  | 'glass_clean'
  | 'gravel_vacuum'
  | 'plant_trim'
  | 'fertilize'
  | 'co2_refill'
  | 'water_test'
  | 'custom';

export interface MaintenanceTask extends Entity {
  tankId: string;
  type: TaskType;
  label: string;
  everyDays: number;
  nextDue: string; // YYYY-MM-DD
  active: boolean;
  oneOff?: boolean; // tâche ponctuelle : désactivée une fois faite
  diagnosisId?: string; // proposée par un diagnostic
}

/** Unité d'une dose d'engrais. */
export type DoseUnit = 'ml' | 'g' | 'pump' | 'drop' | 'tab';

export interface MaintenanceLog extends Entity {
  tankId: string;
  taskId?: string;
  type: TaskType;
  label: string;
  date: string; // ISO datetime
  details?: { waterChangedLiters?: number; product?: string; dose?: string; amount?: number; unit?: DoseUnit; consumableId?: string };
  note?: string;
}
