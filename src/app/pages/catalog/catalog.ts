import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { SpeciesStore } from '../../core/stores/species.store';
import type { SpeciesKind } from '../../core/models';
import { KINDS } from '../../core/labels';
import { issuesIfAdded } from '../../core/rules';
import { Icon } from '../../shared/icon';
import { SpeciesChips } from '../../shared/species-chips';
import { speciesIcon } from '../../shared/visuals';

const FILTERS: { kind: SpeciesKind | 'all'; label: string }[] = [
  { kind: 'all', label: 'Tout' },
  { kind: 'plant', label: 'Plantes' },
  { kind: 'fish', label: 'Poissons' },
  { kind: 'shrimp', label: 'Crevettes' },
  { kind: 'snail', label: 'Escargots' },
];

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

@Component({
  selector: 'app-catalog',
  imports: [RouterLink, Icon, SpeciesChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .search { height: 48px; border-radius: 8px; background: var(--sf); border: 1px solid var(--ln); display: flex; align-items: center; gap: 10px; padding: 0 16px; color: var(--mu); }
    .search:focus-within { border-color: var(--wa); }
    .search input { flex: 1; border: 0; background: transparent; outline: none; font-size: 15px; color: var(--ink); min-width: 0; }
    .filters { display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 2px; }
    .fc { height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--ln); background: var(--sf); color: var(--ink); font: 600 13px var(--font); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer; }
    .fc.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 10px; }
    .sp { background: var(--sf); border: 1px solid var(--ln); border-radius: 8px; overflow: hidden; text-decoration: none; color: var(--ink); display: block; }
    .sp:hover { border-color: var(--mu); color: var(--ink); }
    .img { height: 96px; display: grid; place-items: center; position: relative; border-radius: 0; }
    .tag { position: absolute; left: 8px; top: 8px; font-size: 10px; font-weight: 700; background: var(--sf); color: var(--ink); padding: 2px 6px; border-radius: 5px; }
    .b { padding: 10px 12px 12px; }
    .n { font-weight: 700; font-size: 14px; }
    .s { font-style: italic; font-size: 12px; color: var(--mu); margin: 1px 0 6px; }
    .banner { padding: 10px 14px; background: var(--wab); color: var(--wa); border-color: var(--wa); font-size: 14px; }
  `,
  template: `
    <div class="page" style="gap: 12px">
      <header class="top">
        <div>
          <h1 class="h1">Catalogue</h1>
          <p class="sub"><span class="num">{{ speciesStore.catalog().length }}</span> espèces · <span class="num">{{ plantCount() }}</span> plantes</p>
        </div>
        <a class="btn ton" routerLink="/catalogue/nouvelle"><app-icon name="plus" [size]="20" />Nouvelle espèce</a>
      </header>
      @if (targetTank(); as t) {
        <p class="card banner">Choisis une espèce à ajouter dans <b>{{ t.name }}</b>.</p>
      }
      <label class="search">
        <app-icon name="search" [size]="20" />
        <input placeholder="Nom commun ou scientifique" aria-label="Rechercher une espèce" [value]="query()" (input)="query.set($any($event.target).value)" />
      </label>
      <div class="filters" role="group" aria-label="Filtrer par type">
        @for (f of filters; track f.kind) {
          <button class="fc" [class.on]="kind() === f.kind" [attr.aria-pressed]="kind() === f.kind" (click)="kind.set(f.kind)">{{ f.label }}</button>
        }
      </div>
      @if (store.tankViews().length) {
        <div class="filters" role="group" aria-label="Filtres avancés">
          @for (v of store.tankViews(); track v.tank.id) {
            <button class="fc" [class.on]="compatWith() === v.tank.id" [attr.aria-pressed]="compatWith() === v.tank.id"
              (click)="compatWith.set(compatWith() === v.tank.id ? '' : v.tank.id)">
              <app-icon name="check" [size]="16" />Compatible {{ v.tank.name }}
            </button>
          }
          <button class="fc" [class.on]="noCo2()" [attr.aria-pressed]="noCo2()" (click)="noCo2.set(!noCo2())">Sans CO2</button>
        </div>
      }
      <div class="grid">
        @for (s of results(); track s.id) {
          <a class="sp" [routerLink]="['/catalogue', s.id]" [queryParams]="bac() ? { bac: bac() } : {}">
            <div class="img ph" [class.pl]="s.kind === 'plant'" [class.fa]="s.kind !== 'plant'">
              <span class="tag">{{ kinds[s.kind] }}{{ s.source === 'custom' ? ' · perso' : '' }}</span>
              <app-icon [name]="icon(s)" [size]="38" [stroke]="1.4" />
            </div>
            <div class="b">
              <p class="n">{{ s.commonNames[0] }}</p>
              <p class="s">{{ s.scientificName }}</p>
              <app-species-chips [species]="s" [max]="2" />
            </div>
          </a>
        } @empty {
          <p class="empty" style="grid-column: 1 / -1">Aucune espèce ne correspond.</p>
        }
      </div>
    </div>
  `,
})
export class CatalogPage {
  protected readonly store = inject(AquariumStore);
  protected readonly speciesStore = inject(SpeciesStore);
  /** `?bac=` : ajout d'un habitant dans ce bac. */
  readonly bac = input<string>();

  protected readonly filters = FILTERS;
  protected readonly kinds = KINDS;
  protected readonly icon = speciesIcon;

  protected readonly query = signal('');
  protected readonly kind = signal<SpeciesKind | 'all'>('all');
  protected readonly compatWith = signal('');
  protected readonly noCo2 = signal(false);

  protected readonly targetTank = computed(() => this.store.tanks().find((t) => t.id === this.bac()));
  protected readonly plantCount = computed(() => this.speciesStore.catalog().filter((s) => s.kind === 'plant').length);

  protected readonly results = computed(() => {
    const q = norm(this.query().trim());
    const kind = this.kind();
    const view = this.store.tankViews().find((v) => v.tank.id === this.compatWith());
    const members = view?.members.map((m) => ({ species: m.species, quantity: m.inhabitant.quantity })) ?? [];
    return this.speciesStore
      .catalog()
      .filter((s) => kind === 'all' || s.kind === kind)
      .filter((s) => !q || norm([s.scientificName, ...s.commonNames].join(' ')).includes(q))
      .filter((s) => !this.noCo2() || s.kind !== 'plant' || s.flora?.co2 !== 'required')
      .filter((s) => !view || issuesIfAdded(view.tank, members, s, s.fauna?.minGroup ?? 1).length === 0)
      .sort((a, b) => (a.commonNames[0] ?? '').localeCompare(b.commonNames[0] ?? '', 'fr'));
  });
}
