import Dexie, { type EntityTable } from 'dexie';
import type {
  Inhabitant,
  InhabitantEvent,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  Photo,
  Species,
  Tank,
  WaterTest,
} from './models';

/** Base IndexedDB locale. Toute modification de schéma passe par une nouvelle `version()`. */
export class AquariumDb extends Dexie {
  tanks!: EntityTable<Tank, 'id'>;
  species!: EntityTable<Species, 'id'>;
  inhabitants!: EntityTable<Inhabitant, 'id'>;
  inhabitantEvents!: EntityTable<InhabitantEvent, 'id'>;
  waterTests!: EntityTable<WaterTest, 'id'>;
  tasks!: EntityTable<MaintenanceTask, 'id'>;
  logs!: EntityTable<MaintenanceLog, 'id'>;
  observations!: EntityTable<Observation, 'id'>;
  photos!: EntityTable<Photo, 'id'>;

  constructor(name = 'my-aquarium') {
    super(name);
    this.version(1).stores({
      tanks: 'id, archived',
      species: 'id, kind, source, scientificName',
      inhabitants: 'id, tankId, speciesId',
      inhabitantEvents: 'id, inhabitantId, tankId, date',
      waterTests: 'id, tankId, date',
      tasks: 'id, tankId, nextDue',
      logs: 'id, tankId, taskId, date',
    });
    this.version(2).stores({
      observations: 'id, tankId, date',
    });
    this.version(3).stores({
      photos: 'id, tankId, inhabitantId, date',
    });
  }
}
