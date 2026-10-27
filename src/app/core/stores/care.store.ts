import { DestroyRef, Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';

/** Entretien, bilans visuels et diagnostics. */
@Injectable({ providedIn: 'root' })
export class CareStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly tasks = liveSignal(
    this.destroyRef,
    () => this.db.tasks.orderBy('nextDue').toArray(),
    [],
  );
  readonly logs = liveSignal(
    this.destroyRef,
    () => this.db.logs.orderBy('date').reverse().toArray(),
    [],
  );
  readonly observations = liveSignal(
    this.destroyRef,
    () => this.db.observations.orderBy('date').toArray(),
    [],
  );
  /** Diagnostics IA, du plus ancien au plus récent. */
  readonly diagnoses = liveSignal(
    this.destroyRef,
    () => this.db.diagnoses.orderBy('date').toArray(),
    [],
  );
}
