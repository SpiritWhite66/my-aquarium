import { DestroyRef, Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';

/** Mesures de l'eau. */
@Injectable({ providedIn: 'root' })
export class WaterStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly waterTests = liveSignal(this.destroyRef, () => this.db.waterTests.orderBy('date').toArray(), []);
  /** Mesures CO2, de la plus ancienne à la plus récente. */
  readonly co2Readings = liveSignal(this.destroyRef, () => this.db.co2Readings.orderBy('date').toArray(), []);
}
