import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { MAIN_PARAMS, PARAM_BY_KEY, idealRange, levelOf } from '../../core/rules';
import { agoLabel, fmt, fmtRange, fmtShortDate, speciesName } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { ParamChart } from '../../shared/param-chart';

@Component({
  selector: 'app-water',
  imports: [RouterLink, Icon, ParamChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .v { background: var(--sf); border: 1px solid var(--ln); border-radius: 14px; padding: 8px 10px; }
    .v .k { font-size: 11px; font-weight: 600; color: var(--mu); }
    .v .n { font: 600 18px var(--mono); }
    .v.warn { border-color: var(--wn); background: var(--wnb); }
    .v.warn .n, .v.warn .k { color: var(--wn); }
    .v.danger { border-color: var(--dg); background: var(--dgb); }
    .v.danger .n, .v.danger .k { color: var(--dg); }
    .legend { gap: 6px; font-size: 11px; color: var(--mu); }
    .legend i { width: 14px; height: 10px; border-radius: 3px; background: var(--okb); }
    .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .chart { padding: 12px 14px; }
    .chart .t { font-weight: 700; }
    .chart .r { font-size: 13px; color: var(--mu); }
    .hist .li { font-size: 13px; }
  `,
  template: `
    @if (view(); as v) {
      @if (v.lastTest; as last) {
        <p class="sub" style="margin: 0">Dernier relevé {{ ago(last.date, store.today()) }} ({{ shortDate(last.date) }})</p>
        <section class="grid" aria-label="Dernier relevé">
          @for (c of cells(); track c.key) {
            <div class="v" [class.warn]="c.level === 'warn'" [class.danger]="c.level === 'danger'">
              <p class="k">{{ c.label }}{{ c.level !== 'ok' ? (c.high ? ' ▲' : ' ▼') : '' }}</p>
              <p class="n">{{ c.value }}</p>
            </div>
          }
        </section>

        <a class="btn out" style="align-self: flex-start" routerLink="/import-ia" [queryParams]="{ bac: v.tank.id }">
          <app-icon name="upload" [size]="18" />Lire une photo de tests (IA)
        </a>
        <div class="row between">
          <h2 class="h2">Évolution</h2>
          <div class="row legend"><i></i>Plage idéale du bac</div>
        </div>
        <div class="charts">
          @for (c of charts(); track c.key) {
            <article class="card chart" [class.warn]="c.level === 'warn'" [class.danger]="c.level === 'danger'">
              <div class="row between">
                <p class="t">{{ c.label }}</p>
                @if (c.range) {
                  <p class="num r">idéal {{ c.rangeLabel }}</p>
                }
              </div>
              <app-param-chart [key]="c.key" [tests]="v.tests" [range]="c.range" [label]="c.label" />
              @if (c.from) {
                <p class="sub" style="margin-top: 6px">Plage calculée d’après {{ c.from }}.</p>
              }
              @if (c.conflict) {
                <p class="sub" style="color: var(--wn)">Les plages des espèces ne se recouvrent pas.</p>
              }
            </article>
          }
        </div>

        <section class="stack hist">
          <h2 class="h2">Historique des relevés</h2>
          <div class="card">
            @for (t of history(); track t.id) {
              <div class="li">
                <span class="grow">
                  <b>{{ shortDate(t.date) }}</b>
                  <span class="sub" style="display: block">{{ summary(t.values) }}</span>
                </span>
                <a class="iconbtn" routerLink="/releve" [queryParams]="{ bac: v.tank.id, edit: t.id }" aria-label="Corriger ce relevé"><app-icon name="edit" [size]="18" /></a>
                <button class="iconbtn" (click)="remove(t.id)" aria-label="Supprimer ce relevé"><app-icon name="trash" [size]="18" /></button>
              </div>
            }
          </div>
        </section>
      } @else {
        <div class="card empty">
          <p>Aucun relevé pour ce bac.</p>
          <a class="btn water" routerLink="/releve" [queryParams]="{ bac: v.tank.id }"><app-icon name="plus" [size]="20" />Premier relevé</a>
          <a class="btn out" routerLink="/import-ia" [queryParams]="{ bac: v.tank.id }"><app-icon name="upload" [size]="18" />Lire une photo de tests (IA)</a>
        </div>
      }
      <a class="fab" routerLink="/releve" [queryParams]="{ bac: v.tank.id }"><app-icon name="plus" [size]="20" [stroke]="2.2" />Relevé</a>
    }
  `,
})
export class WaterTab {
  protected readonly store = inject(AquariumStore);
  readonly id = input.required<string>();

  protected readonly ago = agoLabel;
  protected readonly shortDate = fmtShortDate;

  protected readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.id()));
  private readonly species = computed(() => this.view()?.members.map((m) => m.species) ?? []);

  protected readonly cells = computed(() => {
    const v = this.view();
    const values = v?.lastTest?.values ?? {};
    return MAIN_PARAMS.map((key) => {
      const value = values[key];
      const range = idealRange(key, this.species(), v?.tank);
      return {
        key,
        label: PARAM_BY_KEY[key].short,
        value: fmt(value),
        level: value == null ? 'ok' : levelOf(key, value, range),
        high: value != null && range ? value > range.max : false,
      };
    });
  });

  protected readonly charts = computed(() => {
    const v = this.view();
    if (!v) return [];
    const keys = [...new Set(v.tests.flatMap((t) => Object.keys(t.values)))] as (keyof typeof PARAM_BY_KEY)[];
    // Les paramètres hors plage d'abord, puis l'ordre habituel.
    const order = (k: string) => (v.alerts.some((a) => a.key === k) ? -1 : 0) * 100 + MAIN_PARAMS.indexOf(k as never);
    return keys
      .sort((a, b) => order(a) - order(b))
      .map((key) => {
        const def = PARAM_BY_KEY[key];
        const range = idealRange(key, this.species(), v.tank);
        const last = v.lastTest?.values[key];
        return {
          key,
          label: def.label,
          range,
          rangeLabel: range ? fmtRange(range.min, range.max, def.unit) : '',
          from: range?.from.length ? range.from.map(speciesName).join(', ') : '',
          conflict: range?.conflict ?? false,
          level: last == null ? 'ok' : levelOf(key, last, range),
        };
      });
  });

  protected readonly history = computed(() => [...(this.view()?.tests ?? [])].reverse().slice(0, 20));

  protected summary(values: Record<string, number>): string {
    return Object.entries(values)
      .map(([k, v]) => `${PARAM_BY_KEY[k as keyof typeof PARAM_BY_KEY]?.short ?? k} ${fmt(v)}`)
      .join(' · ');
  }

  protected remove(id: string): void {
    if (confirm('Supprimer ce relevé ?')) this.store.deleteWaterTest(id);
  }
}
