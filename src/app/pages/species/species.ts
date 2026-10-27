import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { SpeciesStore } from '../../core/stores/species.store';
import type { QuantityUnit, Range } from '../../core/models';
import {
  DIETS,
  DIFFICULTIES,
  GROWTHS,
  KINDS,
  LIGHTS,
  PLACEMENTS,
  TEMPERAMENTS,
  UNITS,
  ZONES,
  fmt,
  fmtRange,
} from '../../core/labels';
import { idealRange, issuesIfAdded } from '../../core/rules';
import { Icon } from '../../shared/icon';
import { SpeciesChips } from '../../shared/species-chips';
import { speciesIcon } from '../../shared/visuals';
import { LivestockRepo } from '../../core/data/livestock.repo';

// Échelle des barres de paramètres.
const SCALES = {
  temp: { min: 14, max: 32, unit: '°C', label: 'Temp.' },
  ph: { min: 4, max: 9, unit: '', label: 'pH' },
  gh: { min: 0, max: 25, unit: '°d', label: 'GH' },
  kh: { min: 0, max: 20, unit: '°d', label: 'KH' },
} as const;

@Component({
  selector: 'app-species',
  imports: [Icon, SpeciesChips, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .hero { height: 200px; position: relative; display: grid; place-items: center; margin: 0 -16px; border-radius: 0; }
    .hero .iconbtn { position: absolute; top: 14px; left: 14px; }
    @media (min-width: 960px) { .hero { margin: 16px 0 0; border-radius: 8px; } }
    .kind { font-weight: 600; color: var(--pl); font-size: 13px; }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--ln); border-radius: 8px; overflow: hidden; border: 1px solid var(--ln); }
    .facts > div { background: var(--sf); padding: 10px 12px; }
    .facts .k { font-size: 11px; font-weight: 600; color: var(--mu); }
    .facts .v { font-weight: 700; font-size: 14px; margin-top: 2px; }
    .rg { display: grid; grid-template-columns: 44px 1fr 80px; align-items: center; gap: 10px; font-size: 13px; }
    .bar { height: 10px; border-radius: 5px; background: var(--sf2); position: relative; }
    .bar i { position: absolute; top: 0; bottom: 0; border-radius: 5px; background: var(--pl); opacity: .55; }
    .bar b { position: absolute; top: -4px; width: 3px; height: 18px; border-radius: 2px; background: var(--wa); }
    .issue { padding: 12px 14px; border-color: var(--wn); background: var(--wnb); color: var(--wn); display: flex; gap: 10px; }
    .issue p { font-size: 13px; line-height: 1.4; }
    .add { position: sticky; bottom: calc(var(--tabs-h) + 8px); padding: 12px 14px; display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; box-shadow: var(--shadow); }
    .add .field { padding: 4px 10px; flex: 1; min-width: 110px; }
    .add .field input, .add .field select { font-size: 15px; }
    .notes { font-size: 14px; line-height: 1.5; }
  `,
  template: `
    @if (species(); as s) {
      <div class="page" style="gap: 16px; padding-bottom: 24px">
        <div class="hero ph" [class.pl]="s.kind === 'plant'" [class.fa]="s.kind !== 'plant'">
          <app-icon [name]="icon(s)" [size]="72" [stroke]="1.1" />
          <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
          <a class="iconbtn" [routerLink]="['/catalogue', s.id, 'modifier']" style="left: auto; right: 14px"
            [attr.aria-label]="s.source === 'custom' ? 'Modifier la fiche' : 'Personnaliser la fiche'"><app-icon name="edit" [size]="20" /></a>
        </div>
        <div>
          <p class="kind">{{ kinds[s.kind] }}{{ s.flora?.form ? ' · ' + s.flora.form : '' }}</p>
          <h1 class="h1" style="margin-top: 2px">{{ s.commonNames[0] }}</h1>
          <p class="sci">{{ s.scientificName }}{{ s.commonNames.length > 1 ? ' · ' + s.commonNames.slice(1).join(', ') : '' }}</p>
          <div style="margin-top: 10px"><app-species-chips [species]="s" [max]="6" /></div>
        </div>

        <div class="facts">
          @for (f of facts(); track f[0]) {
            <div><p class="k">{{ f[0] }}</p><p class="v">{{ f[1] }}</p></div>
          }
        </div>

        @if (bars().length) {
          <section class="stack">
            <div class="row between">
              <h2 class="h2">Paramètres</h2>
              @if (tank(); as t) {
                <span class="sub" style="margin: 0; font-size: 12px"><b style="color: var(--wa)">|</b> plage actuelle de {{ t.name }}</span>
              }
            </div>
            @for (b of bars(); track b.label) {
              <div class="rg">
                <span style="font-weight: 600">{{ b.label }}</span>
                <div class="bar">
                  <i [style.left.%]="b.left" [style.width.%]="b.width"></i>
                  @if (b.marker != null) { <b [style.left.%]="b.marker"></b> }
                </div>
                <span class="num" style="text-align: right">{{ b.text }}</span>
              </div>
            }
          </section>
        }

        @if (s.notes) {
          <p class="notes">{{ s.notes }}</p>
        }

        @for (i of issues(); track $index) {
          <div class="card issue">
            <app-icon name="warn" [size]="20" />
            <p><b>{{ tank()?.name }} :</b> {{ i.title }}. {{ i.detail }}</p>
          </div>
        }

        @if (store.tankViews().length) {
          <form class="card add" (submit)="$event.preventDefault(); add()">
            <div class="field" style="flex: 2">
              <label for="tank">Bac</label>
              <select id="tank" (change)="tankId.set($any($event.target).value)">
                @for (v of store.tankViews(); track v.tank.id) {
                  <option [value]="v.tank.id" [selected]="v.tank.id === tankId()">{{ v.tank.name }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="q">Quantité</label>
              <input id="q" class="num" inputmode="numeric" [value]="quantity()" (input)="quantity.set($any($event.target).value)" />
            </div>
            <div class="field">
              <label for="u">Unité</label>
              <select id="u" (change)="unit.set($any($event.target).value)">
                @for (u of unitList(); track u[0]) {
                  <option [value]="u[0]" [selected]="u[0] === unit()">{{ u[1][1] }}</option>
                }
              </select>
            </div>
            <button class="btn fill" type="submit"><app-icon name="plus" [size]="20" />Ajouter au bac</button>
          </form>
        }
      </div>
    }
  `,
})
export class SpeciesPage {
  protected readonly store = inject(AquariumStore);
  protected readonly speciesStore = inject(SpeciesStore);
  protected readonly livestockRepo = inject(LivestockRepo);
  protected readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  readonly bac = input<string>();

  protected readonly kinds = KINDS;
  protected readonly icon = speciesIcon;

  protected readonly tankId = signal('');
  protected readonly quantity = signal('1');
  protected readonly unit = signal<QuantityUnit>('individual');

  protected readonly species = computed(() => this.speciesStore.speciesById().get(this.id()));
  private readonly view = computed(() =>
    this.store.tankViews().find((v) => v.tank.id === this.tankId()),
  );
  protected readonly tank = computed(() => this.view()?.tank);

  protected readonly unitList = computed(() => {
    const all = Object.entries(UNITS) as [QuantityUnit, [string, string]][];
    return this.species()?.kind === 'plant'
      ? all.filter(([u]) => u !== 'individual')
      : all.filter(([u]) => u === 'individual');
  });

  protected readonly facts = computed(() => {
    const s = this.species();
    if (!s) return [];
    const out: [string, string][] = [];
    if (s.flora) {
      out.push(
        ['Croissance', GROWTHS[s.flora.growth]],
        ['Lumière', LIGHTS[s.flora.light]],
        ['Placement', PLACEMENTS[s.flora.placement]],
      );
      out.push([
        'CO2',
        { none: 'Inutile', beneficial: 'Conseillé', required: 'Requis' }[s.flora.co2],
      ]);
      if (s.flora.maxHeightCm) out.push(['Hauteur', `≤ ${s.flora.maxHeightCm} cm`]);
      out.push(['Multiplication', s.flora.propagation.join(', ')]);
    }
    if (s.fauna) {
      out.push(
        ['Taille adulte', `${fmt(s.fauna.adultSizeCm)} cm`],
        ['Comportement', TEMPERAMENTS[s.fauna.temperament]],
        ['Zone', ZONES[s.fauna.zone]],
      );
      out.push(['Régime', DIETS[s.fauna.diet]]);
      if (s.fauna.minGroup && s.fauna.minGroup > 1) out.push(['Groupe', `≥ ${s.fauna.minGroup}`]);
      if (s.fauna.minTankLiters) out.push(['Bac', `≥ ${s.fauna.minTankLiters} L`]);
    }
    if (s.difficulty) out.push(['Difficulté', DIFFICULTIES[s.difficulty]]);
    return out;
  });

  protected readonly bars = computed(() => {
    const s = this.species();
    if (!s) return [];
    const v = this.view();
    const others = v?.members.map((m) => m.species).filter((o) => o.id !== s.id) ?? [];
    return (Object.keys(SCALES) as (keyof typeof SCALES)[])
      .filter((k) => s[k])
      .map((k) => {
        const sc = SCALES[k];
        const r = s[k] as Range;
        const pct = (x: number) =>
          Math.min(100, Math.max(0, ((x - sc.min) / (sc.max - sc.min)) * 100));
        // Repère : dernière mesure du bac, sinon milieu de la plage actuelle du bac.
        const measured = v?.lastTest?.values[k];
        const tankRange = others.length ? idealRange(k, others, v?.tank) : undefined;
        const ref =
          measured ??
          (tankRange && !tankRange.conflict ? (tankRange.min + tankRange.max) / 2 : undefined);
        return {
          label: sc.label,
          left: pct(r.min),
          width: pct(r.max) - pct(r.min),
          marker: ref != null ? pct(ref) : null,
          text: fmtRange(r.min, r.max, sc.unit),
        };
      });
  });

  protected readonly issues = computed(() => {
    const s = this.species();
    const v = this.view();
    if (!s || !v) return [];
    const members = v.members.map((m) => ({ species: m.species, quantity: m.inhabitant.quantity }));
    return issuesIfAdded(v.tank, members, s, Number(this.quantity()) || 1);
  });

  constructor() {
    effect(() => {
      if (this.tankId()) return;
      const tanks = this.store.tankViews();
      const id = tanks.find((v) => v.tank.id === this.bac())?.tank.id ?? tanks[0]?.tank.id;
      if (id) this.tankId.set(id);
    });
    effect(() => {
      const s = this.species();
      if (!s) return;
      this.unit.set(
        s.kind === 'plant'
          ? s.flora?.placement === 'floating'
            ? 'rosette'
            : s.flora?.form === 'tige'
              ? 'stem'
              : 'pot'
          : 'individual',
      );
      if (s.fauna?.minGroup && s.fauna.minGroup > 1) this.quantity.set(String(s.fauna.minGroup));
    });
  }

  protected async add(): Promise<void> {
    const s = this.species();
    const q = Math.round(Number(this.quantity().replace(',', '.')));
    if (!s || !this.tankId() || !(q > 0)) return;
    await this.livestockRepo.addInhabitant({
      tankId: this.tankId(),
      speciesId: s.id,
      quantity: q,
      unit: this.unit(),
      addedDate: this.store.today(),
      status: 'healthy',
    });
    void this.router.navigate(['/bacs', this.tankId(), 'population']);
  }
}
