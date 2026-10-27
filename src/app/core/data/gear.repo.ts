import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { Clock } from '../clock';
import { newId, now, type New } from './util';
import { diffSettings } from '../settings-history';
import type { SettingChange, Co2Reading, Consumable, Equipment } from '../models';

/** Matériel, historique de ses réglages, consommables et mesures CO2. */
@Injectable({ providedIn: 'root' })
export class GearRepo {
  private readonly db = inject(AQUARIUM_DB);
  private readonly clock = inject(Clock);

  /**
   * Enregistre un équipement. Si des réglages suivis changent (intensité, horaires…),
   * le changement est historisé à la date `effective` (aujourd'hui par défaut).
   */
  async saveEquipment(
    e: New<Equipment>,
    change?: { effective?: string; note?: string },
  ): Promise<string> {
    const id = e.id ?? newId();
    await this.db.transaction('rw', [this.db.equipment, this.db.settingChanges], async () => {
      const before = e.id ? await this.db.equipment.get(e.id) : undefined;
      await this.db.equipment.put({ ...e, id, updatedAt: now() });
      if (!before) return;
      const date =
        change?.effective && change.effective !== this.clock.today()
          ? new Date(`${change.effective}T12:00`).toISOString()
          : now();
      const note = change?.note?.trim() || undefined;
      await this.db.settingChanges.bulkPut(
        diffSettings(before, e).map((d) => ({
          ...d,
          id: newId(),
          updatedAt: now(),
          date,
          note,
          tankId: e.tankId,
          equipmentId: id,
          equipmentName: e.name,
        })),
      );
    });
    return id;
  }

  async deleteEquipment(id: string): Promise<void> {
    await this.db.equipment.delete(id);
  }

  async updateSettingChange(
    id: string,
    patch: Partial<Pick<SettingChange, 'date' | 'note'>>,
  ): Promise<void> {
    await this.db.settingChanges.update(id, { ...patch, updatedAt: now() });
  }

  async deleteSettingChange(id: string): Promise<void> {
    await this.db.settingChanges.delete(id);
  }

  async saveConsumable(c: New<Consumable>): Promise<string> {
    const id = c.id ?? newId();
    await this.db.consumables.put({ ...c, id, updatedAt: now() });
    return id;
  }

  async setConsumableLevel(id: string, level: Consumable['level']): Promise<void> {
    await this.db.consumables.update(id, { level, updatedAt: now() });
  }

  async deleteConsumable(id: string): Promise<void> {
    await this.db.consumables.delete(id);
  }

  async addCo2Reading(r: New<Co2Reading>): Promise<void> {
    await this.db.co2Readings.put({ ...r, id: r.id ?? newId(), updatedAt: now() });
  }

  async deleteCo2Reading(id: string): Promise<void> {
    await this.db.co2Readings.delete(id);
  }
}
