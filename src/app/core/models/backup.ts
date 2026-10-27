import type { Co2Reading } from './co2';
import type { MaintenanceLog, MaintenanceTask } from './care';
import type { Diagnosis } from './diagnosis';
import type { Consumable, Equipment, SettingChange } from './gear';
import type { Inhabitant, InhabitantEvent } from './livestock';
import type { Observation } from './observation';
import type { ExportedPhoto, Photo } from './photo';
import type { Species } from './species';
import type { Tank } from './tank';
import type { WaterTest } from './water';

/** Contenu de data.json dans une sauvegarde ZIP (version 2) ; la version 1 était un JSON seul. */
export interface ExportFile {
  format: 'my-aquarium';
  version: 1 | 2;
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
    photos?: (Photo | ExportedPhoto)[]; // v1 : images en data URL ; v2 : images dans le ZIP
    equipment?: Equipment[];
    consumables?: Consumable[];
    co2Readings?: Co2Reading[];
    settingChanges?: SettingChange[];
    diagnoses?: Diagnosis[];
  };
}
