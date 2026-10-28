import { InjectionToken } from '@angular/core';
import Dexie, { type EntityTable } from 'dexie';
import type { NotificationPrefs } from './reminders';
import { installOutbox, type OutboxEntry } from './sync-outbox';
import type {
  SettingChange,
  Diagnosis,
  Co2Reading,
  Consumable,
  Equipment,
  Inhabitant,
  InhabitantEvent,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  Photo,
  PhotoFile,
  RefMeta,
  Species,
  Tank,
  WaterTest,
} from './models';

export interface SyncMeta {
  id: 'sync';
  /** Compte dont cet appareil a les données : un autre compte repart d'un envoi complet. */
  userId: string;
  /** Curseur du serveur : tout ce qui est avant a déjà été reçu. */
  cursor: number;
}

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
  photoFiles!: EntityTable<PhotoFile, 'id'>;
  equipment!: EntityTable<Equipment, 'id'>;
  consumables!: EntityTable<Consumable, 'id'>;
  co2Readings!: EntityTable<Co2Reading, 'id'>;
  diagnoses!: EntityTable<Diagnosis, 'id'>;
  settingChanges!: EntityTable<SettingChange, 'id'>;
  /** Préférences de l'appareil lisibles par le service worker (notifications). */
  prefs!: EntityTable<NotificationPrefs, 'id'>;
  /** Point de reprise du catalogue en ligne (hors sauvegardes : propre à l'appareil). */
  refMeta!: EntityTable<RefMeta, 'id'>;
  /** Modifications locales à envoyer au serveur (synchronisation, propre à l'appareil). */
  outbox!: EntityTable<OutboxEntry, 'key'>;
  /** Compte synchronisé et curseur de reprise. */
  syncMeta!: EntityTable<SyncMeta, 'id'>;
  /** Appelé à chaque modification locale d'une table synchronisée. */
  onLocalChange: () => void = () => undefined;

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
    this.version(4).stores({
      equipment: 'id, tankId, type',
      consumables: 'id, category, expiryDate',
      co2Readings: 'id, tankId, date',
    });
    this.version(5).stores({
      diagnoses: 'id, tankId, date',
    });
    this.version(6).stores({
      settingChanges: 'id, tankId, equipmentId, date',
    });
    this.version(7).stores({
      prefs: 'id',
    });
    // Les images quittent la table des photos : la liste des photos ne pèse plus que quelques Ko.
    // Reprise automatique des photos existantes, par paquets pour ne pas tout charger d'un coup.
    this.version(8)
      .stores({ photoFiles: 'id' })
      .upgrade(async (tx) => {
        const ids = (await tx.table('photos').toCollection().primaryKeys()) as string[];
        for (let i = 0; i < ids.length; i += 20) {
          const batch = (await tx.table('photos').bulkGet(ids.slice(i, i + 20))) as (
            (Photo & Partial<Omit<PhotoFile, 'id'>>) | undefined
          )[];
          const files: PhotoFile[] = [];
          const metas: Photo[] = [];
          for (const p of batch) {
            if (!p) continue;
            const { full, thumb, ...meta } = p;
            if (full && thumb) files.push({ id: p.id, full, thumb });
            metas.push(meta);
          }
          await tx.table('photoFiles').bulkPut(files);
          await tx.table('photos').bulkPut(metas);
        }
      });
    this.version(9).stores({ refMeta: 'id' });
    this.version(10).stores({ outbox: 'key', syncMeta: 'id' });
    installOutbox(this, () => {
      this.onLocalChange();
    });
  }
}

/** Base locale de l'appli ; remplacée par une base de test dans les specs. */
export const AQUARIUM_DB = new InjectionToken<AquariumDb>('AQUARIUM_DB', {
  providedIn: 'root',
  factory: () => new AquariumDb(),
});
