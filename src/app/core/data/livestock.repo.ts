import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { Clock } from '../clock';
import { newId, now, type New } from './util';
import { isAlive } from '../rules';
import type { Inhabitant, InhabitantEvent, Species } from '../models';

/** Habitants, leurs événements et les fiches espèces personnelles. */
@Injectable({ providedIn: 'root' })
export class LivestockRepo {
  private readonly db = inject(AQUARIUM_DB);
  private readonly clock = inject(Clock);

  async addInhabitant(data: New<Inhabitant>): Promise<string> {
    return this.db.transaction('rw', [this.db.inhabitants, this.db.inhabitantEvents], async () => {
      // Même espèce déjà présente et vivante : on cumule la quantité.
      const existing = await this.findAlive(data.tankId, data.speciesId, data.unit);
      const id = existing?.id ?? newId();
      if (existing) {
        await this.db.inhabitants.update(id, {
          quantity: existing.quantity + data.quantity,
          updatedAt: now(),
        });
      } else {
        await this.db.inhabitants.put({ ...data, id, updatedAt: now() });
      }
      await this.addEvent({
        inhabitantId: id,
        tankId: data.tankId,
        date: now(),
        type: 'added',
        quantityDelta: data.quantity,
        note: data.origin,
      });
      return id;
    });
  }

  /** Habitant vivant d'une espèce dans un bac, lu dans la base (pas dans les signals, parfois en retard). */
  private async findAlive(
    tankId: string,
    speciesId: string,
    unit: Inhabitant['unit'],
  ): Promise<Inhabitant | undefined> {
    const list = await this.db.inhabitants.where('tankId').equals(tankId).toArray();
    return list.find((i) => i.speciesId === speciesId && isAlive(i) && i.unit === unit);
  }

  async updateInhabitant(id: string, changes: Partial<Inhabitant>): Promise<void> {
    await this.db.inhabitants.update(id, { ...changes, updatedAt: now() });
  }

  async addEvent(e: New<InhabitantEvent>): Promise<void> {
    await this.db.inhabitantEvents.put({
      ...e,
      id: e.id ?? newId(),
      updatedAt: now(),
    });
  }

  /** Enregistre un événement et ajuste la quantité (naissance, décès, bouture…). */
  async recordEvent(
    inhabitant: Inhabitant,
    type: InhabitantEvent['type'],
    quantityDelta = 0,
    note?: string,
  ): Promise<void> {
    await this.db.transaction('rw', [this.db.inhabitants, this.db.inhabitantEvents], async () => {
      await this.addEvent({
        inhabitantId: inhabitant.id,
        tankId: inhabitant.tankId,
        date: now(),
        type,
        quantityDelta: quantityDelta || undefined,
        note,
      });
      if (!quantityDelta) return;
      const current = (await this.db.inhabitants.get(inhabitant.id)) ?? inhabitant;
      const quantity = Math.max(0, current.quantity + quantityDelta);
      await this.updateInhabitant(inhabitant.id, {
        quantity,
        status: quantity === 0 && type === 'death' ? 'dead' : current.status,
      });
    });
  }

  async deleteInhabitant(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.inhabitants, this.db.photos, this.db.photoFiles, this.db.inhabitantEvents],
      async () => {
        await this.db.photoFiles.bulkDelete(
          await this.db.photos.where('inhabitantId').equals(id).primaryKeys(),
        );
        await this.db.inhabitants.delete(id);
        await this.db.photos.where('inhabitantId').equals(id).delete();
        await this.db.inhabitantEvents.where('inhabitantId').equals(id).delete();
      },
    );
  }

  /** Déplace tout ou partie d'un habitant vers un autre bac (quarantaine → bac principal…). */
  async moveInhabitant(inh: Inhabitant, toTankId: string, quantity = inh.quantity): Promise<void> {
    if (toTankId === inh.tankId || quantity < 1) return;
    const from = (await this.db.tanks.get(inh.tankId))?.name ?? 'bac';
    const to = (await this.db.tanks.get(toTankId))?.name ?? 'bac';
    await this.db.transaction(
      'rw',
      [this.db.inhabitants, this.db.inhabitantEvents, this.db.photos],
      async () => {
        const current = await this.db.inhabitants.get(inh.id);
        if (!current) return;
        if (quantity >= current.quantity) {
          await this.db.inhabitants.update(inh.id, { tankId: toTankId, updatedAt: now() });
          // L'historique et les photos suivent l'habitant.
          await this.db.inhabitantEvents
            .where('inhabitantId')
            .equals(inh.id)
            .modify({ tankId: toTankId });
          await this.db.photos.where('inhabitantId').equals(inh.id).modify({ tankId: toTankId });
          await this.addEvent({
            inhabitantId: inh.id,
            tankId: toTankId,
            date: now(),
            type: 'moved',
            note: `${from} → ${to}`,
          });
          return;
        }
        await this.updateInhabitant(inh.id, { quantity: current.quantity - quantity });
        await this.addEvent({
          inhabitantId: inh.id,
          tankId: current.tankId,
          date: now(),
          type: 'moved',
          quantityDelta: -quantity,
          note: `${quantity} vers ${to}`,
        });
        const target = await this.findAlive(toTankId, current.speciesId, current.unit);
        if (target) {
          await this.updateInhabitant(target.id, { quantity: target.quantity + quantity });
          await this.addEvent({
            inhabitantId: target.id,
            tankId: toTankId,
            date: now(),
            type: 'moved',
            quantityDelta: quantity,
            note: `depuis ${from}`,
          });
        } else {
          const id = newId();
          await this.db.inhabitants.put({
            ...current,
            id,
            tankId: toTankId,
            quantity,
            addedDate: this.clock.today(),
            origin: `Déplacé depuis ${from}`,
            updatedAt: now(),
          });
          await this.addEvent({
            inhabitantId: id,
            tankId: toTankId,
            date: now(),
            type: 'moved',
            quantityDelta: quantity,
            note: `depuis ${from}`,
          });
        }
      },
    );
  }

  /** Fait pointer les habitants d'une fiche vers une autre (personnalisation d'une fiche intégrée). */
  async replaceSpecies(oldId: string, newId: string): Promise<void> {
    await this.db.inhabitants
      .where('speciesId')
      .equals(oldId)
      .modify({ speciesId: newId, updatedAt: now() });
  }

  /** Supprime une fiche personnelle ; les habitants d'une fiche personnalisée retrouvent la fiche intégrée. */
  async deleteSpecies(id: string): Promise<void> {
    const s = await this.db.species.get(id);
    if (s?.source !== 'custom') return;
    await this.db.transaction('rw', [this.db.inhabitants, this.db.species], async () => {
      if (s.overrides) await this.replaceSpecies(id, s.overrides);
      await this.db.species.delete(id);
    });
  }

  async saveSpecies(species: New<Species>): Promise<string> {
    const id = species.id ?? `custom-${newId()}`;
    await this.db.species.put({ ...species, id, source: 'custom', updatedAt: now() });
    return id;
  }
}
