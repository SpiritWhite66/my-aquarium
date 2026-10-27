import { DestroyRef, Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';

/** Habitants des bacs et leur historique. */
@Injectable({ providedIn: 'root' })
export class PopulationStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly inhabitants = liveSignal(this.destroyRef, () => this.db.inhabitants.toArray(), []);
  readonly inhabitantEvents = liveSignal(this.destroyRef, () => this.db.inhabitantEvents.orderBy('date').reverse().toArray(), []);
}
