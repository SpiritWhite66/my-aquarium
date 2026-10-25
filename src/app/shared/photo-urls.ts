import { Injectable, computed, effect, inject } from '@angular/core';
import { AquariumStore } from '../core/store';

/**
 * Transforme les images stockées (Blob) en URL affichables.
 * Les URL sont mises en cache et libérées quand la photo est supprimée.
 * `url()` lit un signal : appelée depuis un template, elle se met à jour toute seule.
 */
@Injectable({ providedIn: 'root' })
export class PhotoUrls {
  private readonly store = inject(AquariumStore);
  private readonly cache = new Map<string, string>();
  private readonly byId = computed(() => new Map(this.store.photos().map((p) => [p.id, p])));

  constructor() {
    effect(() => {
      const photos = this.byId();
      for (const [key, url] of this.cache) {
        if (!photos.has(key.split(':')[0])) {
          URL.revokeObjectURL(url);
          this.cache.delete(key);
        }
      }
    });
  }

  url(id: string | undefined | null, variant: 'thumb' | 'full' = 'thumb'): string | undefined {
    const photo = id ? this.byId().get(id) : undefined;
    if (!photo) return undefined;
    const key = `${photo.id}:${variant}`;
    let url = this.cache.get(key);
    if (!url) {
      url = URL.createObjectURL(photo[variant]);
      this.cache.set(key, url);
    }
    return url;
  }
}
