import { DestroyRef, Injectable, computed, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';

/** Fiches espèces : catalogue intégré et fiches personnelles. */
@Injectable({ providedIn: 'root' })
export class SpeciesStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly species = liveSignal(this.destroyRef, () => this.db.species.toArray(), []);

  readonly speciesById = computed(() => new Map(this.species().map((s) => [s.id, s])));

  /** Catalogue affiché : les fiches intégrées personnalisées sont remplacées par leur copie. */
  readonly catalog = computed(() => {
    const overridden = new Set(
      this.species()
        .map((s) => s.overrides)
        .filter(Boolean),
    );
    return this.species().filter((s) => !overridden.has(s.id));
  });
}
