import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AquariumStore } from '../../core/store';
import { PhotoStore } from '../../core/stores/photo.store';
import { PopulationStore } from '../../core/stores/population.store';
import { SpeciesStore } from '../../core/stores/species.store';
import type { Photo } from '../../core/models';
import { fmtShortDate, speciesName } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { PhotoAdd } from '../../shared/photo-add';
import { PhotoCompare } from '../../shared/photo-compare';
import { PhotoUrls } from '../../shared/photo-urls';
import { PhotoViewer } from '../../shared/photo-viewer';

/** Galerie des photos d'un bac (le bac lui-même et ses habitants). */
@Component({
  selector: 'app-photos',
  imports: [Icon, PhotoAdd, PhotoViewer, PhotoCompare],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
    .t { position: relative; aspect-ratio: 1; border: 0; padding: 0; border-radius: 14px; overflow: hidden; background: var(--sf2); cursor: pointer; }
    .t img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .t .tag { position: absolute; left: 4px; bottom: 4px; right: 4px; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 6px; background: rgba(8, 14, 11, .72); color: #f3f1ea; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t .star { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; border-radius: 12px; display: grid; place-items: center; background: var(--sf); color: var(--wn); }
  `,
  template: `
    @if (tank(); as t) {
      <div class="row between">
        <h2 class="h2"><app-icon name="camera" [size]="18" />Photos <span class="sub" style="margin: 0; font-weight: 500">{{ list().length }}</span></h2>
        @if (tankPhotos().length > 1) {
          <button class="btn ton" type="button" style="height: 38px" (click)="comparing.set(true)"><app-icon name="eye" [size]="18" />Comparer</button>
        }
      </div>
      @if (list().length) {
        <div class="grid">
          @for (p of list(); track p.id) {
            <button class="t" type="button" (click)="viewing.set(p.id)" [attr.aria-label]="label(p)">
              <img [src]="urls.url(p.id)" alt="" loading="lazy" />
              @if (t.coverPhotoId === p.id) {
                <span class="star" title="Photo de couverture"><app-icon name="star" [size]="14" [stroke]="2" /></span>
              }
              <span class="tag">{{ p.caption || date(p.date) }}</span>
            </button>
          }
        </div>
      } @else {
        <div class="card empty">
          <span class="ph pl" style="width: 64px; height: 64px"><app-icon name="camera" [size]="30" [stroke]="1.4" /></span>
          <p>Garde une trace de l’évolution du bac : une photo de temps en temps suffit.</p>
        </div>
      }
      <app-photo-add cls="fab" label="Photo" [tankId]="t.id" />
      @if (comparing()) {
        <app-photo-compare [photos]="tankPhotos()" [tankId]="t.id" (closed)="comparing.set(false)" />
      }
      @if (viewing(); as id) {
        <app-photo-viewer [photos]="list()" [startId]="id" (closed)="viewing.set(null)" />
      }
    }
  `,
})
export class PhotosTab {
  protected readonly store = inject(AquariumStore);
  protected readonly photoStore = inject(PhotoStore);
  protected readonly populationStore = inject(PopulationStore);
  protected readonly speciesStore = inject(SpeciesStore);
  protected readonly urls = inject(PhotoUrls);
  protected readonly date = fmtShortDate;

  readonly id = input.required<string>();
  protected readonly viewing = signal<string | null>(null);
  protected readonly comparing = signal(false);

  protected readonly tank = computed(() => this.store.tanks().find((t) => t.id === this.id()));
  protected readonly list = computed(() => this.photoStore.photos().filter((p) => p.tankId === this.id()));

  /** Photos du bac lui-même (pas celles des habitants), seules comparables entre elles. */
  protected readonly tankPhotos = computed(() => this.list().filter((p) => !p.inhabitantId));

  protected label(p: Photo): string {
    const inh = p.inhabitantId && this.populationStore.inhabitants().find((i) => i.id === p.inhabitantId);
    const what = inh ? speciesName(this.speciesStore.speciesById().get(inh.speciesId)) : 'Bac';
    return `${what}, ${fmtShortDate(p.date)}${p.caption ? ' : ' + p.caption : ''}`;
  }
}
