import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { Icon } from '../../shared/icon';
import { TankCard } from '../../shared/tank-card';

@Component({
  selector: 'app-tanks',
  imports: [RouterLink, Icon, TankCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .archived { opacity: .7; }
  `,
  template: `
    <div class="page">
      <header class="top">
        <h1 class="h1">Bacs</h1>
        <a class="btn fill" routerLink="/bacs/nouveau"><app-icon name="plus" [size]="20" />Nouveau bac</a>
      </header>
      @if (store.ready() && !store.tankViews().length) {
        <p class="card empty">Aucun bac pour l’instant.</p>
      }
      <div class="grid">
        @for (v of store.tankViews(); track v.tank.id) {
          <app-tank-card [view]="v" />
        }
      </div>
      @if (archived().length) {
        <section class="stack">
          <h2 class="h2">Archivés</h2>
          <div class="card archived">
            @for (t of archived(); track t.id) {
              <a class="li" [routerLink]="['/bacs', t.id, 'modifier']">
                <span class="grow">{{ t.name }}</span><app-icon name="chevron" [size]="18" />
              </a>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class TanksPage {
  protected readonly store = inject(AquariumStore);
  protected readonly archived = computed(() => this.store.tanks().filter((t) => t.archived));
}
