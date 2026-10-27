import { DestroyRef, Injectable, computed, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';

/** Métadonnées des photos (les images sont lues à la demande par PhotoRepo). */
@Injectable({ providedIn: 'root' })
export class PhotoStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  /** Photos, de la plus récente à la plus ancienne. */
  readonly photos = liveSignal(
    this.destroyRef,
    () => this.db.photos.orderBy('date').reverse().toArray(),
    [],
  );

  /** Dernière photo de chaque habitant (id habitant → id photo). */
  readonly inhabitantCovers = computed(() => {
    const m = new Map<string, string>();
    for (const p of this.photos())
      if (p.inhabitantId && !m.has(p.inhabitantId)) m.set(p.inhabitantId, p.id);
    return m;
  });
}
