import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TankView } from '../core/store';
import { TANK_TYPES, fmt } from '../core/labels';
import { Icon } from './icon';
import { PhotoUrls } from './photo-urls';

/** Carte d'un bac : visuel, état, volume, dernière température et dernier pH. */
@Component({
  selector: 'app-tank-card',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    a { display: block; overflow: hidden; text-decoration: none; color: inherit; height: 100%; }
    a:hover { color: inherit; border-color: var(--mu); }
    .ph { height: 96px; border-radius: 0; position: relative; background: var(--sf2) !important; color: var(--mu) !important; }
    .ph app-icon { opacity: .5; }
    .state { position: absolute; top: 10px; right: 10px; }
    .body { padding: 12px 14px 14px; }
    .name { font-weight: 700; font-size: 16px; }
    .vals { margin-top: 10px; gap: 18px; }
    .big { font: 600 22px var(--mono); letter-spacing: -0.01em; }
    .big small { font-size: 13px; }
  `,
  template: `
    @let v = view();
    <a class="card" [class.danger]="v.level === 'danger'" [routerLink]="['/bacs', v.tank.id]">
      <div class="ph" [class.pl]="isPlanted()" [class.fa]="!isPlanted()">
        @if (urls.url(v.tank.coverPhotoId); as cover) {
          <img class="img-abs" [src]="cover" alt="" />
        } @else {
          <app-icon [name]="isPlanted() ? 'landscape' : 'fish'" [size]="30" [stroke]="1.4" />
        }
        <span class="pill state" [class.ok]="v.level === 'ok'" [class.wn]="v.level === 'warn'" [class.dg]="v.level === 'danger'">
          <span class="dot"></span>{{ v.level === 'danger' && v.statusLabel === 'OK' ? 'Danger' : v.statusLabel }}
        </span>
      </div>
      <div class="body">
        <p class="name">{{ v.tank.name }}</p>
        <p class="sub">
          <span class="num">{{ v.tank.volumeNet ?? v.tank.volumeGross }}</span> L · {{ v.plants.length }} plante{{ v.plants.length > 1 ? 's' : '' }} ·
          {{ v.fauna.length }} {{ v.fauna.length > 1 ? 'animaux' : 'animal' }}
        </p>
        <div class="row vals">
          <div>
            <p class="lbl">Temp.</p>
            <p class="big">{{ fmt(v.lastTest?.values?.temp) }}<small>°C</small></p>
          </div>
          <div>
            <p class="lbl">pH</p>
            <p class="big">{{ fmt(v.lastTest?.values?.ph) }}</p>
          </div>
        </div>
      </div>
    </a>
  `,
})
export class TankCard {
  readonly view = input.required<TankView>();
  protected readonly fmt = fmt;
  protected readonly urls = inject(PhotoUrls);
  protected readonly types = TANK_TYPES;
  protected readonly isPlanted = computed(() => this.view().tank.type === 'planted' || this.view().plants.length > 0);
}
