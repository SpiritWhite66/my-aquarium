import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { TANK_TYPES } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { PhotoUrls } from '../../shared/photo-urls';

/** En-tête du bac + onglets Population / Eau / Entretien. */
@Component({
  selector: 'app-tank-detail',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .hero { height: 150px; position: relative; overflow: hidden; display: grid; place-items: center; margin: 0 -16px; }
    .hero .iconbtn { position: absolute; top: 14px; }
    .head { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; }
    .title { font-size: 24px; font-weight: 700; }
    @media (min-width: 960px) { .hero { margin: 16px 0 0; border-radius: 8px; } }
    .hero:not(:has(img)) { height: 96px; background: var(--sf2) !important; color: var(--mu) !important; }
  `,
  template: `
    @if (view(); as v) {
      <div class="page" style="gap: 16px">
        <div class="hero ph" [class.pl]="planted()" [class.fa]="!planted()">
          @if (urls.url(v.tank.coverPhotoId, 'full'); as cover) {
            <img class="img-abs" [src]="cover" alt="" />
          } @else {
            <app-icon [name]="planted() ? 'landscape' : 'fish'" [size]="56" [stroke]="1.2" />
          }
          <a class="iconbtn" routerLink="/bacs" aria-label="Retour aux bacs" style="left: 14px"><app-icon name="back" /></a>
          <a class="iconbtn" [routerLink]="['/bacs', v.tank.id, 'modifier']" aria-label="Modifier le bac" style="right: 14px">
            <app-icon name="edit" [size]="20" />
          </a>
        </div>
        <div class="head">
          <div class="row between">
            <div>
              <h1 class="title">{{ v.tank.name }}</h1>
              <p class="sub">
                <span class="num">{{ v.tank.volumeNet ?? v.tank.volumeGross }}</span> L · {{ types[v.tank.type] }}
                @if (v.tank.co2) { · CO2 }
                @if (v.tank.lighting?.photoperiodHours) { · éclairage {{ v.tank.lighting.photoperiodHours }} h }
              </p>
            </div>
            <span class="pill" [class.ok]="v.level === 'ok'" [class.wn]="v.level === 'warn'" [class.dg]="v.level === 'danger'">
              <span class="dot"></span>{{ v.statusLabel }}
            </span>
          </div>
          <nav class="seg" aria-label="Sections du bac">
            <a routerLink="population" routerLinkActive="on">Population</a>
            <a routerLink="eau" routerLinkActive="on">Eau</a>
            <a routerLink="entretien" routerLinkActive="on">Entretien</a>
            <a routerLink="photos" routerLinkActive="on">Photos</a>
          </nav>
        </div>
        <router-outlet />
      </div>
    } @else if (store.ready()) {
      <div class="page"><p class="card empty" style="margin-top: 24px">Ce bac n’existe pas.</p></div>
    }
  `,
})
export class TankDetailPage {
  protected readonly store = inject(AquariumStore);
  protected readonly types = TANK_TYPES;
  protected readonly urls = inject(PhotoUrls);
  readonly id = input.required<string>();
  protected readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.id()));
  protected readonly planted = computed(() => {
    const v = this.view();
    return !!v && (v.tank.type === 'planted' || v.plants.length > 0);
  });
}
