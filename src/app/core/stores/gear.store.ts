import { DestroyRef, Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';

/** Matériel, consommables et historique des réglages. */
@Injectable({ providedIn: 'root' })
export class GearStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly equipment = liveSignal(this.destroyRef, () => this.db.equipment.toArray(), []);
  readonly consumables = liveSignal(this.destroyRef, () => this.db.consumables.toArray(), []);
  /** Changements de réglages du matériel, du plus ancien au plus récent. */
  readonly settingChanges = liveSignal(this.destroyRef, () => this.db.settingChanges.orderBy('date').toArray(), []);
}
