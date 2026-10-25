import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { STATUSES, unitLabel } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { SpeciesChips } from '../../shared/species-chips';
import { ObservationCard } from '../../shared/observation-card';
import { DiagnosisCard } from '../../shared/diagnosis-card';
import { speciesIcon } from '../../shared/visuals';
import { PhotoUrls } from '../../shared/photo-urls';

@Component({
  selector: 'app-population',
  imports: [RouterLink, Icon, SpeciesChips, ObservationCard, DiagnosisCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 18px; }
    .nm { font-weight: 700; font-size: 15px; }
    .sci { margin: 1px 0 6px; font-size: 12.5px; }
    .qty { text-align: right; flex: none; }
    .qty b { display: block; font: 600 20px var(--mono); }
    .qty > span { font-size: 11px; color: var(--mu); }
    .qty .pill { height: 20px; margin-top: 4px; }
    .issue { padding: 12px 14px; display: flex; gap: 10px; }
    .issue app-icon { color: var(--wn); }
    .issue p { font-size: 13px; line-height: 1.4; }
    .links { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; font-weight: 600; }
  `,
  template: `
    @if (view(); as v) {
      @if (lastDiagnosis(); as d) {
        <app-diagnosis-card [diagnosis]="d" />
      }
      @if (v.lastObservation; as o) {
        <app-observation-card [observation]="o" />
      }
      <p class="links">
        <a routerLink="/import-ia" [queryParams]="{ bac: v.tank.id }">Importer un inventaire</a>
        @if (!lastDiagnosis()) {
          <a routerLink="/diagnostic" [queryParams]="{ bac: v.tank.id }">Demander un diagnostic</a>
        }
      </p>
      @for (i of v.issues; track $index) {
        <div class="card warn issue">
          <app-icon name="warn" [size]="20" />
          <p><b>{{ i.title }}.</b> {{ i.detail }}</p>
        </div>
      }

      @for (g of groups(); track g.title) {
        <section class="stack" style="gap: 8px">
          <h2 class="h2"><app-icon [name]="g.icon" [size]="18" />{{ g.title }}
            <span class="sub" style="margin: 0; font-weight: 500">{{ g.items.length }} espèce{{ g.items.length > 1 ? 's' : '' }}</span>
          </h2>
          @if (g.items.length) {
            <div class="card">
              @for (m of g.items; track m.inhabitant.id) {
                <a class="li" [routerLink]="['/bacs', v.tank.id, 'habitants', m.inhabitant.id]">
                  <div class="ph" [class.pl]="m.species.kind === 'plant'" [class.fa]="m.species.kind !== 'plant'" style="width: 52px; height: 52px">
                    @if (urls.url(store.inhabitantCovers().get(m.inhabitant.id)); as photo) {
                      <img class="img-abs" [src]="photo" alt="" />
                    } @else {
                      <app-icon [name]="icon(m.species)" [size]="24" [stroke]="1.6" />
                    }
                  </div>
                  <div class="grow">
                    <p class="nm">{{ m.species.commonNames[0] }}</p>
                    <p class="sci">{{ m.species.scientificName }}</p>
                    <app-species-chips [species]="m.species" [max]="3" />
                  </div>
                  <div class="qty">
                    <b>{{ m.inhabitant.approximate ? '~' : '' }}{{ m.inhabitant.quantity }}</b>
                    <span>{{ unit(m.inhabitant.unit, m.inhabitant.quantity) }}</span>
                    <div>
                      <span class="pill" [class.ok]="m.inhabitant.status === 'healthy'" [class.wn]="m.inhabitant.status !== 'healthy'">
                        {{ statuses[m.inhabitant.status] }}
                      </span>
                    </div>
                  </div>
                </a>
              }
            </div>
          } @else {
            <p class="card empty">{{ g.empty }}</p>
          }
        </section>
      }
      <a class="fab" routerLink="/catalogue" [queryParams]="{ bac: v.tank.id }"><app-icon name="plus" [size]="20" [stroke]="2.2" />Habitant</a>
    }
  `,
})
export class PopulationTab {
  protected readonly store = inject(AquariumStore);
  protected readonly urls = inject(PhotoUrls);
  readonly id = input.required<string>();

  protected readonly statuses = STATUSES;
  protected readonly icon = speciesIcon;
  protected readonly unit = unitLabel;

  protected readonly lastDiagnosis = computed(() => this.store.diagnoses().filter((d) => d.tankId === this.id()).at(-1));
  protected readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.id()));
  // La flore passe en premier : les plantes comptent autant que les animaux.
  protected readonly groups = computed(() => {
    const v = this.view();
    if (!v) return [];
    return [
      { title: 'Flore', icon: 'sprout', items: v.plants, empty: 'Aucune plante. Ajoute-en depuis le catalogue.' },
      { title: 'Faune', icon: 'fish', items: v.fauna, empty: 'Aucun animal pour l’instant.' },
    ];
  });
}
