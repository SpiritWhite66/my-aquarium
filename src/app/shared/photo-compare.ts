import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import type { Photo } from '../core/models';
import { AquariumStore } from '../core/store';
import { daysBetween } from '../core/dates';
import { elapsedLabel, fmtDate, speciesName, unitLabel } from '../core/labels';
import { Icon } from './icon';
import { PhotoUrls } from './photo-urls';

/** Comparaison avant / après de deux photos : curseur ou côte à côte. */
@Component({
  selector: 'app-photo-compare',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .overlay { position: fixed; inset: 0; z-index: 50; background: #0a110e; color: #f3f1ea; display: flex; flex-direction: column; outline: none; overflow-y: auto; }
    .bar { padding: 10px 12px; display: flex; align-items: center; gap: 8px; }
    .title { flex: 1; font-weight: 700; font-size: 16px; }
    .body { padding: 0 12px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; max-width: 760px; width: 100%; margin: 0 auto; }
    .seg { background: rgba(255, 255, 255, .1); }
    .seg button { color: #c9d6cd; }
    .seg .on { background: #f3f1ea; color: #17231d; }
    .cmp { position: relative; margin: 0 auto; overflow: hidden; border-radius: 12px; background: #16211d; touch-action: pan-y; user-select: none; max-width: 100%; }
    .cmp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
    .lab { position: absolute; top: 8px; padding: 3px 9px; border-radius: 10px; background: rgba(8, 14, 11, .75); font-size: 12px; font-weight: 700; pointer-events: none; }
    .lab.l { left: 8px; } .lab.r { right: 8px; }
    .line { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: #f3f1ea; pointer-events: none; box-shadow: 0 0 8px rgba(0, 0, 0, .5); }
    .grip { position: absolute; top: 50%; left: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 8px; background: #f3f1ea; color: #17231d; display: grid; place-items: center; font-size: 14px; font-weight: 700; }
    .range { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; margin: 0; }
    .cmp:has(.range:focus-visible) { outline: 2px solid #8ec2e2; outline-offset: 2px; }
    .side { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .side figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .side img { width: 100%; object-fit: cover; border-radius: 12px; display: block; }
    .side figcaption { font-size: 13px; font-weight: 600; }
    .pick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pick .field { background: rgba(255, 255, 255, .08); border-color: rgba(255, 255, 255, .2); }
    .pick label { color: #c9d6cd; }
    .pick select { color: #f3f1ea; }
    .pick option { color: #17231d; }
    .facts { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .facts .chips span { background: rgba(136, 208, 162, .2); color: #88d0a2; }
    .muted { color: #c9d6cd; font-size: 13px; }
  `,
  template: `
    <div #root class="overlay" role="dialog" aria-modal="true" aria-label="Comparaison avant et après" tabindex="-1" (keydown.escape)="closed.emit()">
      <div class="bar">
        <button class="iconbtn" type="button" aria-label="Fermer" (click)="closed.emit()"><app-icon name="close" /></button>
        <span class="title">Avant / après</span>
        <div class="seg" role="group" aria-label="Affichage" style="width: 190px">
          <button type="button" [class.on]="mode() === 'slider'" [attr.aria-pressed]="mode() === 'slider'" (click)="mode.set('slider')">Curseur</button>
          <button type="button" [class.on]="mode() === 'side'" [attr.aria-pressed]="mode() === 'side'" (click)="mode.set('side')">Côte à côte</button>
        </div>
      </div>

      @if (pair(); as p) {
        <div class="body">
          @if (mode() === 'slider') {
            <div class="cmp" [style.aspect-ratio]="ratio()" [style.width]="'min(100%, ' + 62 * ratio() + 'vh)'">
              <img [src]="urls.url(p[1].id, 'full')" [alt]="'Après, ' + date(p[1].date)" />
              <img [src]="urls.url(p[0].id, 'full')" [alt]="'Avant, ' + date(p[0].date)" [style.clip-path]="'inset(0 ' + (100 - pos()) + '% 0 0)'" />
              <span class="lab l">Avant · {{ date(p[0].date) }}</span>
              <span class="lab r">Après · {{ date(p[1].date) }}</span>
              <span class="line" [style.left.%]="pos()"><span class="grip" aria-hidden="true">↔</span></span>
              <input class="range" type="range" min="0" max="100" step="1" [value]="pos()" (input)="pos.set(+$any($event.target).value)"
                aria-label="Curseur avant / après" [attr.aria-valuetext]="pos() + ' % de la photo avant'" />
            </div>
          } @else {
            <div class="side" [style.grid-template-columns]="ratio() > 1 ? '1fr' : '1fr 1fr'">
              <figure><img [src]="urls.url(p[0].id, 'full')" [style.aspect-ratio]="ratio()" alt="" /><figcaption>Avant · {{ date(p[0].date) }}</figcaption></figure>
              <figure><img [src]="urls.url(p[1].id, 'full')" [style.aspect-ratio]="ratio()" alt="" /><figcaption>Après · {{ date(p[1].date) }}</figcaption></figure>
            </div>
          }

          <div class="facts">
            <p><b>{{ elapsed() }}</b> entre les deux photos.</p>
            @if (showAdditions() && additions().length) {
              <p class="muted">Ajouté entre-temps :</p>
              <div class="chips">
                @for (a of additions(); track a) { <span class="chip">{{ a }}</span> }
              </div>
            }
          </div>
        </div>
      }

      <div class="body pick">
        <div class="field">
          <label for="cmp-a">Photo 1</label>
          <select id="cmp-a" (change)="firstId.set($any($event.target).value)">
            @for (o of options(); track o.id) { <option [value]="o.id" [selected]="o.id === firstId()">{{ o.label }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="cmp-b">Photo 2</label>
          <select id="cmp-b" (change)="secondId.set($any($event.target).value)">
            @for (o of options(); track o.id) { <option [value]="o.id" [selected]="o.id === secondId()">{{ o.label }}</option> }
          </select>
        </div>
      </div>
    </div>
  `,
})
export class PhotoCompare {
  private readonly store = inject(AquariumStore);
  protected readonly urls = inject(PhotoUrls);
  protected readonly date = fmtDate;

  /** Photos parmi lesquelles choisir, dans n'importe quel ordre. */
  readonly photos = input.required<Photo[]>();
  readonly tankId = input.required<string>();
  /** Liste des espèces ajoutées entre les deux dates (utile pour un bac entier). */
  readonly showAdditions = input(true);
  readonly closed = output<void>();

  protected readonly mode = signal<'slider' | 'side'>('slider');
  protected readonly pos = signal(50);

  private readonly sorted = computed(() => [...this.photos()].sort((a, b) => a.date.localeCompare(b.date)));
  // Par défaut : la plus ancienne et la plus récente.
  protected readonly firstId = linkedSignal(() => this.sorted()[0]?.id);
  protected readonly secondId = linkedSignal(() => this.sorted().at(-1)?.id);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  /** [avant, après] : toujours dans l'ordre des dates, quel que soit l'ordre des choix. */
  protected readonly pair = computed<[Photo, Photo] | undefined>(() => {
    const list = this.photos();
    const a = list.find((p) => p.id === this.firstId());
    const b = list.find((p) => p.id === this.secondId());
    if (!a || !b) return undefined;
    return a.date <= b.date ? [a, b] : [b, a];
  });

  protected readonly options = computed(() =>
    [...this.sorted()].reverse().map((p) => ({ id: p.id, label: `${fmtDate(p.date)}${p.caption ? ' · ' + p.caption : ''}` })),
  );

  protected readonly ratio = computed(() => {
    const p = this.pair()?.[0];
    return p ? Math.min(1.8, Math.max(0.6, p.width / p.height)) : 4 / 3;
  });

  protected readonly elapsed = computed(() => {
    const p = this.pair();
    return p ? elapsedLabel(daysBetween(p[0].date.slice(0, 10), p[1].date.slice(0, 10))) : '';
  });

  protected readonly additions = computed(() => {
    const p = this.pair();
    if (!p) return [];
    const from = p[0].date.slice(0, 10);
    const to = p[1].date.slice(0, 10);
    return this.store
      .inhabitants()
      .filter((i) => i.tankId === this.tankId() && i.addedDate > from && i.addedDate <= to)
      .map((i) => `${speciesName(this.store.speciesById().get(i.speciesId))} (${i.quantity} ${unitLabel(i.unit, i.quantity)})`);
  });

  constructor() {
    afterNextRender(() => this.root()?.nativeElement.focus());
  }
}
