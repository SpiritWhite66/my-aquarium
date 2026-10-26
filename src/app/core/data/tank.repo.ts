import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { Clock } from '../clock';
import { newId, now, type New } from './util';
import { addDays } from '../dates';
import { TASK_TYPES } from '../labels';
import type { MaintenanceTask, Tank, TaskType } from '../models';

/** Bacs : création, archivage, suppression avec tout ce qui leur est rattaché. */
@Injectable({ providedIn: 'root' })
export class TankRepo {
  private readonly db = inject(AQUARIUM_DB);
  private readonly clock = inject(Clock);

  async saveTank(tank: New<Tank>, withDefaultTasks = false): Promise<string> {
    const id = tank.id ?? newId();
    await this.db.tanks.put({ ...tank, id, updatedAt: now() } as Tank);
    if (withDefaultTasks)
      await this.db.tasks.bulkPut(defaultTasks(id, tank.type, tank.co2, this.clock.today()));
    return id;
  }

  async archiveTank(id: string, archived = true): Promise<void> {
    await this.db.tanks.update(id, { archived, updatedAt: now() });
  }

  async deleteTank(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.tanks,
        this.db.inhabitants,
        this.db.inhabitantEvents,
        this.db.waterTests,
        this.db.tasks,
        this.db.logs,
        this.db.observations,
        this.db.photos,
        this.db.photoFiles,
        this.db.co2Readings,
        this.db.equipment,
        this.db.diagnoses,
        this.db.settingChanges,
      ],
      async () => {
        await this.db.photoFiles.bulkDelete(
          (await this.db.photos.where('tankId').equals(id).primaryKeys()) as string[],
        );
        // Le matériel du bac est conservé, en réserve.
        await this.db.equipment.where('tankId').equals(id).modify({ tankId: undefined });
        await this.db.settingChanges.where('tankId').equals(id).delete();
        await this.db.tanks.delete(id);
        for (const table of [
          this.db.inhabitants,
          this.db.inhabitantEvents,
          this.db.waterTests,
          this.db.tasks,
          this.db.logs,
          this.db.observations,
          this.db.photos,
          this.db.co2Readings,
          this.db.diagnoses,
        ]) {
          await table.where('tankId').equals(id).delete();
        }
      },
    );
  }
}

/** Tâches proposées à la création d'un bac. */
export function defaultTasks(
  tankId: string,
  type: Tank['type'],
  co2: boolean,
  today: string,
): MaintenanceTask[] {
  const t = (type: TaskType, everyDays: number, label = TASK_TYPES[type]): MaintenanceTask => ({
    id: newId(),
    updatedAt: now(),
    tankId,
    type,
    label,
    everyDays,
    nextDue: addDays(today, everyDays),
    active: true,
  });
  const list = [
    t('water_change', 7, 'Changement d’eau 30 %'),
    t('water_test', 7),
    t('glass_clean', 7),
    t('filter_clean', 30),
  ];
  if (type === 'planted' || type === 'community') {
    list.push(t('fertilize', 7), t('plant_trim', 21));
  }
  if (co2) list.push(t('co2_refill', 60));
  return list;
}
