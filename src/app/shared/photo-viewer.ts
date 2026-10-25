import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, linkedSignal, output, viewChild } from '@angular/core';
import type { Photo } from '../core/models';
import { AquariumStore } from '../core/store';
import { fmtShortDate, speciesName } from '../core/labels';
import { Icon } from './icon';
import { Router } from '@angular/router';
import { PhotoUrls } from './photo-urls';

/** Visionneuse plein écran : navigation, légende, photo de couverture, téléchargement, suppression. */
@Component({
  selector: 'app-photo-viewer',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .overlay { position: fixed; inset: 0; z-index: 50; background: #0a110e; color: #f3f1ea; display: flex; flex-direction: column; outline: none; }
    .bar { padding: 10px 12px; display: flex; align-items: center; gap: 8px; }
    .stage { flex: 1; min-height: 0; position: relative; display: grid; place-items: center; padding: 0 8px; }
    .stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }
    .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 22px; border: 0; background: rgba(243, 241, 237, .85); color: #17231d; display: grid; place-items: center; cursor: pointer; }
    .nav:disabled { display: none; }
    .prev { left: 8px; } .next { right: 8px; }
    .info { padding: 12px 16px calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; max-width: 640px; width: 100%; margin: 0 auto; }
    .meta { color: #c9d6cd; font-size: 13px; }
    .info .field { background: rgba(255, 255, 255, .08); border-color: rgba(255, 255, 255, .2); }
    .info .field label { color: #c9d6cd; }
    .info .field:focus-within { background: rgba(255, 255, 255, .14); border-color: #8ec2e2; }
    .info input { color: #f3f1ea; }
    .count { flex: 1; font-size: 14px; }
    .iconbtn { text-decoration: none; }
  `,
  template: `
    @if (current(); as p) {
      <div #root class="overlay" role="dialog" aria-modal="true" aria-label="Photo" tabindex="-1" (keydown)="onKey($event)">
        <div class="bar">
          <button class="iconbtn" type="button" aria-label="Fermer" (click)="closed.emit()"><app-icon name="close" /></button>
          <span class="count num">{{ index() + 1 }} / {{ photos().length }}</span>
          <button class="iconbtn" type="button" aria-label="Analyser avec l’IA" title="Analyser avec l’IA" (click)="toAi(p)"><app-icon name="upload" /></button>
          <a class="iconbtn" [href]="urls.url(p.id, 'full')" [download]="filename(p)" aria-label="Télécharger la photo"><app-icon name="download" /></a>
          <button class="iconbtn" type="button" aria-label="Supprimer la photo" (click)="remove(p)"><app-icon name="trash" /></button>
        </div>
        <div class="stage">
          <img [src]="urls.url(p.id, 'full')" [alt]="p.caption || subject(p)" />
          <button class="nav prev" type="button" aria-label="Photo précédente" [disabled]="photos().length < 2" (click)="go(-1)"><app-icon name="back" /></button>
          <button class="nav next" type="button" aria-label="Photo suivante" [disabled]="photos().length < 2" (click)="go(1)"><app-icon name="chevron" /></button>
        </div>
        <div class="info">
          <p class="meta">{{ date(p.date) }} · {{ subject(p) }}</p>
          <div class="field">
            <label for="caption">Légende</label>
            <input id="caption" [value]="p.caption ?? ''" placeholder="Ajouter une légende" (change)="store.setCaption(p.id, $any($event.target).value)" />
          </div>
          @if (!p.inhabitantId) {
            <button class="btn ton" type="button" style="align-self: flex-start" (click)="toggleCover(p)">
              <app-icon name="star" [size]="18" />{{ isCover(p) ? 'Photo de couverture' : 'Définir comme couverture' }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class PhotoViewer {
  protected readonly store = inject(AquariumStore);
  protected readonly urls = inject(PhotoUrls);
  protected readonly date = fmtShortDate;
  private readonly router = inject(Router);

  readonly photos = input.required<Photo[]>();
  readonly startId = input.required<string>();
  readonly closed = output<void>();

  private readonly selectedId = linkedSignal(() => this.startId());
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  protected readonly current = computed(() => this.photos().find((p) => p.id === this.selectedId()) ?? this.photos()[0]);
  protected readonly index = computed(() => Math.max(0, this.photos().findIndex((p) => p.id === this.current()?.id)));

  constructor() {
    // Focus dans la boîte de dialogue pour que le clavier (Échap, flèches) fonctionne.
    afterNextRender(() => this.root()?.nativeElement.focus());
    effect(() => {
      if (!this.photos().length) this.closed.emit();
    });
  }

  protected go(step: number): void {
    const list = this.photos();
    if (list.length < 2) return;
    this.selectedId.set(list[(this.index() + step + list.length) % list.length].id);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.closed.emit();
    // Dans le champ de légende, les flèches déplacent le curseur.
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') this.go(-1);
    if (e.key === 'ArrowRight') this.go(1);
  }

  protected subject(p: Photo): string {
    if (!p.inhabitantId) return this.store.tanks().find((t) => t.id === p.tankId)?.name ?? 'Bac';
    const inh = this.store.inhabitants().find((i) => i.id === p.inhabitantId);
    return speciesName(inh && this.store.speciesById().get(inh.speciesId));
  }

  protected filename(p: Photo): string {
    return `${this.subject(p).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${p.date.slice(0, 10)}.jpg`;
  }

  /**
   * Envoie la photo à une app d'IA (Claude…) via le partage du téléphone, avec la demande d'analyse,
   * puis ouvre l'écran d'import pour coller la réponse. Sans partage de fichiers : téléchargement.
   */
  protected async toAi(p: Photo): Promise<void> {
    const file = new File([p.full], this.filename(p), { type: 'image/jpeg' });
    const text = p.inhabitantId
      ? 'Avec le skill my-aquarium-json : bilan visuel (sanity) de cette photo.'
      : 'Avec le skill my-aquarium-json : inventaire (inventory) puis bilan visuel (sanity) de cette photo de mon bac.';
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else {
        const a = document.createElement('a');
        a.href = this.urls.url(p.id, 'full')!;
        a.download = file.name;
        a.click();
        await navigator.clipboard?.writeText(text).catch(() => undefined);
      }
    } catch {
      return; // partage annulé
    }
    this.closed.emit();
    this.router.navigate(['/import-ia'], { queryParams: { bac: p.tankId } });
  }

  protected isCover(p: Photo): boolean {
    return this.store.tanks().find((t) => t.id === p.tankId)?.coverPhotoId === p.id;
  }

  protected toggleCover(p: Photo): void {
    this.store.setCover(p.tankId, this.isCover(p) ? undefined : p.id);
  }

  protected async remove(p: Photo): Promise<void> {
    if (!confirm('Supprimer cette photo ?')) return;
    // On se place sur la voisine avant de supprimer pour ne pas revenir à la première.
    const list = this.photos();
    const neighbor = list[this.index() + 1] ?? list[this.index() - 1];
    if (neighbor) this.selectedId.set(neighbor.id);
    await this.store.deletePhoto(p);
  }
}
