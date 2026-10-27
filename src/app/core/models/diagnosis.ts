import type { Entity } from './entity';
import type { TaskType } from './care';

export interface DiagnosisAction {
  title: string;
  detail?: string;
  priority: 'now' | 'soon' | 'later';
  task?: { type: TaskType; label: string; everyDays?: number; inDays?: number };
  done?: boolean;
  taskId?: string; // tâche créée dans l'app
}

export interface Diagnosis extends Entity {
  tankId: string;
  date: string; // ISO datetime
  question?: string;
  summary: string;
  hypotheses: { title: string; probability: 'high' | 'medium' | 'low'; evidence?: string[]; against?: string[] }[];
  actions: DiagnosisAction[];
  followUp?: { inDays: number; measure?: string[] };
  warnings?: string[];
}
