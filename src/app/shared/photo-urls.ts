import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AquariumStore } from '../core/store';
import { PhotoStore } from '../core/stores/photo.store';
import { PhotoRepo } from '../core/data/photo.repo';
import { must } from '../core/assert';

type Variant = 'thumb' | 'full';

/**
 * Transforme les images stockées en URL affichables.
 * Les images sont lues dans la base à la première demande, puis gardées en cache ;
 * les URL sont libérées quand la photo est supprimée.
 * `url()` lit un signal : appelée depuis un template, elle s'affiche dès que l'image est prête.
 */
@Injectable({ providedIn: 'root' })
export class PhotoUrls {
  private readonly store = inject(AquariumStore);
  private readonly photoStore = inject(PhotoStore);
  private readonly photoRepo = inject(PhotoRepo);
  private readonly ids = computed(() => new Set(this.photoStore.photos().map((p) => p.id)));
  private readonly ready = signal(new Map<string, string>());
  private readonly pending = new Set<string>();

  constructor() {
    effect(() => {
      const ids = this.ids();
      const cache = this.ready();
      const gone = [...cache.keys()].filter((key) => !ids.has(key.split(':')[0]));
      if (!gone.length) return;
      const next = new Map(cache);
      for (const key of gone) {
        URL.revokeObjectURL(must(next.get(key)));
        next.delete(key);
      }
      this.ready.set(next);
    });
  }

  url(id: string | undefined | null, variant: Variant = 'thumb'): string | undefined {
    if (!id || !this.ids().has(id)) return undefined;
    const key = `${id}:${variant}`;
    const url = this.ready().get(key);
    if (!url) void this.load(id, variant, key);
    return url;
  }

  private async load(id: string, variant: Variant, key: string): Promise<void> {
    if (this.pending.has(key)) return;
    this.pending.add(key);
    try {
      const file = await this.photoRepo.photoFile(id);
      if (!file) return;
      const next = new Map(this.ready());
      next.set(key, URL.createObjectURL(file[variant]));
      this.ready.set(next);
    } finally {
      this.pending.delete(key);
    }
  }
}
