import type { Entity } from './entity';

export type EquipmentType =
  'filter' | 'heater' | 'light' | 'co2' | 'pump' | 'air' | 'thermometer' | 'controller' | 'other';

/** Plage horaire quotidienne « HH:MM ». */
export interface DailySchedule {
  on: string;
  off: string;
}

export interface LightSpec {
  channels?: string[]; // Blanc, Rouge, Vert, Bleu…
  powerW?: number;
  lumens?: number;
  kelvin?: number;
  levels?: number; // nombre de niveaux de puissance
  intensityPct?: number; // réglage actuel
  par?: number; // µmol/m²/s au sol, si mesuré
  schedule?: DailySchedule;
  rampMinutes?: number; // lever / coucher de soleil
  siesta?: DailySchedule; // pause en milieu de journée
}

export interface FilterSpec {
  flowLh?: number; // débit annoncé
  media?: string;
}

export interface HeaterSpec {
  powerW?: number;
  setpointC?: number;
}

export interface Co2Spec {
  source?: 'cylinder' | 'citric' | 'yeast';
  cylinderL?: number;
  diffuser?: string;
  solenoid?: boolean;
  schedule?: DailySchedule;
}

export interface Equipment extends Entity {
  tankId?: string; // vide : en réserve
  type: EquipmentType;
  name: string;
  brand?: string;
  model?: string;
  purchaseDate?: string; // YYYY-MM-DD
  price?: number;
  warrantyMonths?: number;
  specs?: string; // débit, puissance…
  notes?: string;
  light?: LightSpec;
  filter?: FilterSpec;
  heater?: HeaterSpec;
  co2?: Co2Spec;
}

export type ConsumableCategory =
  'food' | 'fertilizer' | 'conditioner' | 'test_kit' | 'co2' | 'medicine' | 'substrate' | 'other';
export type StockLevel = 'full' | 'half' | 'low' | 'empty';

export interface Consumable extends Entity {
  name: string;
  category: ConsumableCategory;
  brand?: string;
  level: StockLevel;
  openedDate?: string;
  expiryDate?: string; // YYYY-MM-DD
  price?: number;
  notes?: string;
}

// ---------- Historique des réglages ----------
/** Changement d'un réglage du matériel, enregistré automatiquement quand on modifie l'équipement. */
export interface SettingChange extends Entity {
  tankId?: string;
  equipmentId: string;
  equipmentName: string;
  date: string; // ISO datetime de prise d'effet
  field:
    | 'light.intensityPct'
    | 'light.schedule'
    | 'light.siesta'
    | 'light.photoperiod'
    | 'light.rampMinutes'
    | 'co2.schedule'
    | 'heater.setpointC'
    | 'filter.flowLh';
  from?: string;
  to?: string;
  note?: string; // raison du changement
}
