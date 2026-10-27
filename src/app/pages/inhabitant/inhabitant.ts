import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { PhotoStore } from '../../core/stores/photo.store';
import { PopulationStore } from '../../core/stores/population.store';
import { SpeciesStore } from '../../core/stores/species.store';
import type { HealthStatus, Inhabitant, InhabitantEventType } from '../../core/models';
import { STATUSES, fmtShortDate, unitLabel } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { speciesIcon } from '../../shared/visuals';
import { PhotoAdd } from '../../shared/photo-add';
import { PhotoCompare } from '../../shared/photo-compare';
import { PhotoUrls } from '../../shared/photo-urls';
import { PhotoViewer } from '../../shared/photo-viewer';
import { LivestockRepo } from '../../core/data/livestock.repo';

interface QuickEvent {
  type: InhabitantEventType;
  label: string;
  sign: 1 | -1 | 0;
}

const FAUNA_EVENTS: QuickEvent[] = [
  { type: 'birth', label: 'Naissance', sign: 1 },
  { type: 'death', label: 'Décès', sign: -1 },
  { type: 'disease', label: 'Maladie', sign: 0 },
  { type: 'treatment', label: 'Traitement', sign: 0 },
  { type: 'note', label: 'Note', sign: 0 },
];
const FLORA_EVENTS: QuickEvent[] = [
  { type: 'trim', label: 'Taille', sign: 0 },
  { type: 'propagated', label: 'Bouture', sign: 1 },
  { type: 'death', label: 'Retrait / fonte', sign: -1 },
  { type: 'note', label: 'Note', sign: 0 },
];
const EVENT_LABELS: Record<InhabitantEventType, string> = {
  added: 'Ajout',
  birth: 'Naissance',
  death: 'Décès ou retrait',
  disease: 'Maladie',
  treatment: 'Traitement',
  trim: 'Taille',
  propagated: 'Bouture',
  moved: 'Déplacement',
  note: 'Note',
};

/** Fiche d'un habitant d'un bac : quantité, état et journal. */
@Component({
  selector: 'app-inhabitant',
  imports: [RouterLink, Icon, PhotoAdd, PhotoViewer, PhotoCompare],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .ev { display: flex; flex-wrap: wrap; gap: 8px; }
    .ev .btn { height: 40px; }
    .log .li { display: block; }
    .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 6px; }
    .th { aspect-ratio: 1; border: 0; padding: 0; border-radius: 12px; overflow: hidden; background: var(--sf2); cursor: pointer; }
    .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
  `,
  template: `
    @if (data(); as d) {
      <div class="page" style="max-width: 640px">
        <header class="top" style="justify-content: flex-start">
          <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
          <div class="ph" [class.pl]="isPlant()" [class.fa]="!isPlant()" style="width: 52px; height: 52px">
            @if (urls.url(photos()[0]?.id); as photo) {
              <img class="img-abs" [src]="photo" alt="" />
            } @else {
              <app-icon [name]="icon(d.species)" [size]="26" [stroke]="1.6" />
            }
          </div>
          <div class="grow">
            <h1 class="h1" style="font-size: 22px">{{ d.species.commonNames[0] }}</h1>
            <p class="sci">{{ d.species.scientificName }} · <a [routerLink]="['/catalogue', d.species.id]">fiche</a></p>
          </div>
        </header>

        <div class="form-grid">
          <div class="field">
            <label for="qty">Quantité ({{ unit(d.inhabitant.unit, 2) }})</label>
            <input id="qty" class="num" inputmode="numeric" [value]="d.inhabitant.quantity" (change)="setQuantity(d.inhabitant, $any($event.target).value)" />
          </div>
          <div class="field">
            <label for="st">État</label>
            <select id="st" (change)="setStatus(d.inhabitant, $any($event.target).value)">
              @for (s of statusList; track s[0]) {
                <option [value]="s[0]" [selected]="s[0] === d.inhabitant.status">{{ s[1] }}</option>
              }
            </select>
          </div>
          <div class="field full">
            <label for="pl">Emplacement dans le bac</label>
            <input id="pl" [value]="d.inhabitant.placementNote ?? ''" placeholder="Arrière gauche…"
              (change)="livestockRepo.updateInhabitant(d.inhabitant.id, { placementNote: $any($event.target).value || undefined })" />
          </div>
        </div>

        @if (otherTanks().length) {
          <section class="stack">
            <h2 class="h2">Déplacer vers un autre bac</h2>
            <div class="form-grid">
              <div class="field">
                <label for="to">Bac</label>
                <select id="to" (change)="moveTo.set($any($event.target).value)">
                  @for (t of otherTanks(); track t.id) { <option [value]="t.id" [selected]="t.id === moveTo()">{{ t.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="mq">Quantité (sur {{ d.inhabitant.quantity }})</label>
                <input id="mq" class="num" inputmode="numeric" [value]="moveQty() || d.inhabitant.quantity" (input)="moveQty.set(+$any($event.target).value || 0)" />
              </div>
            </div>
            <button class="btn ton" type="button" style="align-self: flex-start" (click)="move(d.inhabitant)">Déplacer</button>
          </section>
        }

        <section class="stack">
          <h2 class="h2">Noter un événement</h2>
          <div class="field">
            <label for="note">Détail (facultatif)</label>
            <input id="note" [value]="note()" (input)="note.set($any($event.target).value)" placeholder="6 têtes replantées…" />
          </div>
          <div class="ev">
            @for (e of events(); track e.type) {
              <button class="btn ton" type="button" (click)="record(d.inhabitant, e)">{{ e.label }}{{ e.sign > 0 ? ' +1' : e.sign < 0 ? ' −1' : '' }}</button>
            }
          </div>
        </section>

        <section class="stack">
          <h2 class="h2"><app-icon name="camera" [size]="18" />Photos <span class="sub" style="margin: 0; font-weight: 500">{{ photos().length }}</span></h2>
          @if (photos().length) {
            <div class="thumbs">
              @for (p of photos(); track p.id) {
                <button type="button" class="th" (click)="viewing.set(p.id)" [attr.aria-label]="'Photo du ' + date(p.date)">
                  <img [src]="urls.url(p.id)" alt="" loading="lazy" />
                </button>
              }
            </div>
          }
          <div class="row" style="flex-wrap: wrap; gap: 8px">
            <app-photo-add [tankId]="d.inhabitant.tankId" [inhabitantId]="d.inhabitant.id" />
            @if (photos().length > 1) {
              <button class="btn out" type="button" (click)="comparing.set(true)"><app-icon name="eye" [size]="18" />Comparer</button>
            }
          </div>
        </section>
        @if (comparing()) {
          <app-photo-compare [photos]="photos()" [tankId]="d.inhabitant.tankId" [showAdditions]="false" (closed)="comparing.set(false)" />
        }
        @if (viewing(); as id) {
          <app-photo-viewer [photos]="photos()" [startId]="id" (closed)="viewing.set(null)" />
        }

        <section class="stack log">
          <h2 class="h2">Journal</h2>
          <div class="card">
            @for (e of d.events; track e.id) {
              <div class="li">
                <b>{{ eventLabels[e.type] }}</b>
                @if (e.quantityDelta) { <span class="num"> ({{ e.quantityDelta > 0 ? '+' : '' }}{{ e.quantityDelta }})</span> }
                <p class="sub">{{ date(e.date) }}{{ e.note ? ' · ' + e.note : '' }}</p>
              </div>
            } @empty {
              <p class="empty">Aucun événement.</p>
            }
          </div>
        </section>

        <button class="btn danger" type="button" style="align-self: flex-start" (click)="remove(d.inhabitant)">
          <app-icon name="trash" [size]="18" />Supprimer de l’inventaire
        </button>
      </div>
    }
  `,
})
export class InhabitantPage {
  protected readonly store = inject(AquariumStore);
  protected readonly photoStore = inject(PhotoStore);
  protected readonly populationStore = inject(PopulationStore);
  protected readonly speciesStore = inject(SpeciesStore);
  protected readonly livestockRepo = inject(LivestockRepo);
  protected readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  readonly hid = input.required<string>();

  protected readonly statusList = Object.entries(STATUSES) as [HealthStatus, string][];
  protected readonly eventLabels = EVENT_LABELS;
  protected readonly icon = speciesIcon;
  protected readonly unit = unitLabel;
  protected readonly date = fmtShortDate;
  protected readonly note = signal('');
  protected readonly urls = inject(PhotoUrls);
  protected readonly viewing = signal<string | null>(null);
  protected readonly comparing = signal(false);
  protected readonly photos = computed(() =>
    this.photoStore.photos().filter((p) => p.inhabitantId === this.hid()),
  );

  protected readonly data = computed(() => {
    const inhabitant = this.populationStore.inhabitants().find((i) => i.id === this.hid());
    const species = inhabitant && this.speciesStore.speciesById().get(inhabitant.speciesId);
    if (!inhabitant || !species) return undefined;
    const events = this.populationStore
      .inhabitantEvents()
      .filter((e) => e.inhabitantId === inhabitant.id);
    return { inhabitant, species, events };
  });
  protected readonly isPlant = computed(() => this.data()?.species.kind === 'plant');
  protected readonly events = computed(() => (this.isPlant() ? FLORA_EVENTS : FAUNA_EVENTS));

  protected readonly moveQty = signal(0);
  protected readonly otherTanks = computed(() =>
    this.store.activeTanks().filter((t) => t.id !== this.data()?.inhabitant.tankId),
  );
  protected readonly moveTo = linkedSignal(() => this.otherTanks()[0]?.id ?? '');

  protected async move(i: Inhabitant): Promise<void> {
    const to = this.moveTo();
    const qty = Math.min(this.moveQty() || i.quantity, i.quantity);
    if (!to || qty < 1) return;
    const name = this.store.tanks().find((t) => t.id === to)?.name;
    if (!confirm(`Déplacer ${qty} ${unitLabel(i.unit, qty)} vers « ${name} » ?`)) return;
    await this.livestockRepo.moveInhabitant(i, to, qty);
    this.moveQty.set(0);
    // Déplacement complet : on suit l'habitant dans son nouveau bac.
    if (qty >= i.quantity)
      void this.router.navigate(['/bacs', to, 'habitants', i.id], { replaceUrl: true });
  }

  protected setQuantity(i: Inhabitant, raw: string): void {
    const q = Math.max(0, Math.round(Number(raw.replace(',', '.'))));
    if (Number.isFinite(q))
      void this.livestockRepo.updateInhabitant(i.id, { quantity: q, approximate: false });
  }

  protected setStatus(i: Inhabitant, status: HealthStatus): void {
    void this.livestockRepo.updateInhabitant(i.id, { status });
  }

  protected async record(i: Inhabitant, e: QuickEvent): Promise<void> {
    await this.livestockRepo.recordEvent(i, e.type, e.sign, this.note().trim() || undefined);
    this.note.set('');
  }

  protected async remove(i: Inhabitant): Promise<void> {
    if (
      !confirm('Supprimer cet habitant et son journal ? (Pour un décès, préfère l’état « Mort ».)')
    )
      return;
    await this.livestockRepo.deleteInhabitant(i.id);
    this.location.back();
  }
}
