// Modèle de données de l'application (voir APP.md).
// Chaque enregistrement a un UUID et un `updatedAt` pour préparer la future synchro avec un backend.

export interface Entity {
  id: string;
  updatedAt: string; // ISO datetime
}

// ---------- Bacs ----------
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
}

// ---------- Catalogue ----------
export type SpeciesKind = 'fish' | 'shrimp' | 'snail' | 'plant' | 'other';

export interface Range {
  min: number;
  max: number;
}

export type Predation = 'shrimp_fry' | 'shrimp' | 'snails' | 'small_fish';

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

// ---------- Inventaire ----------
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
  | 'added'
  | 'birth'
  | 'death'
  | 'disease'
  | 'treatment'
  | 'trim'
  | 'propagated'
  | 'moved'
  | 'note';

export interface InhabitantEvent extends Entity {
  inhabitantId: string;
  tankId: string;
  date: string;
  type: InhabitantEventType;
  quantityDelta?: number;
  note?: string;
}

// ---------- Paramètres de l'eau ----------
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

// ---------- Entretien ----------
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
}

export interface MaintenanceLog extends Entity {
  tankId: string;
  taskId?: string;
  type: TaskType;
  label: string;
  date: string; // ISO datetime
  details?: { waterChangedLiters?: number; product?: string; dose?: string };
  note?: string;
}

// ---------- Photos ----------
export interface Photo extends Entity {
  tankId: string;
  inhabitantId?: string; // vide : photo du bac
  date: string; // ISO datetime de la prise (ou de l'ajout)
  caption?: string;
  full: Blob; // ~1600 px
  thumb: Blob; // ~400 px
  width: number;
  height: number;
}

/** Photo telle qu'écrite dans une sauvegarde JSON (images en data URL). */
export type ExportedPhoto = Omit<Photo, 'full' | 'thumb'> & { full: string; thumb: string };

// ---------- Bilans visuels (analyse « sanity » d'une photo par une IA) ----------
export type FindingCategory =
  | 'algae'
  | 'fish_health'
  | 'invertebrate_health'
  | 'plant_health'
  | 'water_clarity'
  | 'equipment'
  | 'aquascape'
  | 'other';

export interface Finding {
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
}

// ---------- Export ----------
export interface ExportFile {
  format: 'my-aquarium';
  version: 1;
  exportedAt: string;
  data: {
    tanks: Tank[];
    species: Species[]; // fiches personnelles uniquement
    inhabitants: Inhabitant[];
    inhabitantEvents: InhabitantEvent[];
    waterTests: WaterTest[];
    tasks: MaintenanceTask[];
    logs: MaintenanceLog[];
    observations?: Observation[]; // ajouté après la v1 du format, facultatif
    photos?: ExportedPhoto[]; // idem
  };
}
