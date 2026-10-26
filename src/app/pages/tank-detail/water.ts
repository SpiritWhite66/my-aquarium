import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { MAIN_PARAMS, PARAM_BY_KEY, idealRange, levelOf, measuredParams } from '../../core/rules';
import { agoLabel, fmt, fmtRange, fmtShortDate, speciesName } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { ParamChart } from '../../shared/param-chart';
import { CYCLING_LABELS, CO2_TARGET, DROP_CHECKER, co2Advice, co2FromKhPh, co2FromPhDrop, co2Status, cyclingPhase, latestKhPh, trendOf } from '../../core/insights';
import { Co2Counter } from '../../shared/co2-counter';
import { PhDaySheet } from '../../shared/ph-day-sheet';
import { describeChange } from '../../core/settings-history';

@Component({
  selector: 'app-water',
  imports: [RouterLink, Icon, ParamChart, Co2Counter, PhDaySheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--sf); border: 1px solid var(--ln); border-radius: 10px; overflow: hidden; }
    .v { padding: 8px 10px; box-shadow: 1px 1px 0 var(--ln); }
    .v .k { font-size: 11px; font-weight: 600; color: var(--mu); }
    .v .n { font: 600 18px var(--mono); }
    
    .v.warn .n, .v.warn .k { color: var(--wn); }
    
    .v.danger .n, .v.danger .k { color: var(--dg); }
    .legend { gap: 6px; font-size: 11px; color: var(--mu); }
    .legend i { width: 14px; height: 10px; border-radius: 3px; background: var(--okb); }
    .legend .dash { width: 0; height: 12px; border-left: 1px dashed var(--mu); margin-left: 8px; }
    .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .chart { padding: 12px 14px; }
    .chart .t { font-weight: 700; }
    .chart .r { font-size: 13px; color: var(--mu); }
    .hist .li { font-size: 13px; }
    .co2 { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .big { font: 600 24px var(--mono); }
    .est { padding: 2px 0 2px 12px; border-left: 3px solid var(--ok); display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
    .est.warn { border-left-color: var(--wn); }
    .est.danger { border-left-color: var(--dg); }
    .big small { font-size: 12px; }
    .dcv { display: flex; align-items: center; gap: 6px; font-weight: 700; margin-top: 4px; }
    .dcv i { width: 14px; height: 14px; border-radius: 7px; }
    .dcv i.blue { background: #2f6fd6; } .dcv i.green { background: #2f9e55; } .dcv i.yellow { background: #e3c22b; }
    .trend { font-size: 13px; font-weight: 600; color: var(--wa); margin-top: 4px; }
    .trend.bad { color: var(--wn); }
    .cyc { padding: 14px; display: flex; flex-direction: column; gap: 10px; border-color: var(--wa); }
    .cyc.ok-card { border-color: var(--ok); }
    .steps { display: flex; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .steps li { flex: 1; text-align: center; font-size: 11px; font-weight: 600; padding: 6px 2px; border-radius: 8px; background: var(--sf2); color: var(--mu); }
    .steps li.past { background: var(--okb); color: var(--ok); }
    .steps li.on { background: var(--wa); color: var(--on-wa); }
  `,
  template: `
    @if (view(); as v) {
      @if (v.tank.cycling) {
        @let phase = cycling();
        <section class="card cyc" [class.ok-card]="phase === 'done'">
          <div class="row between">
            <h2 class="h2"><app-icon name="bubble" [size]="18" />Cyclage du bac</h2>
            <span class="pill" [class.ok]="phase === 'done'" [class.wn]="phase === 'nitrite' || phase === 'ammonia'">{{ cyclingLabels[phase].title }}</span>
          </div>
          <ol class="steps" aria-label="Étapes du cyclage">
            @for (s of cyclingSteps; track s.key) {
              <li [class.on]="s.key === phase" [class.past]="stepIndex(s.key) < stepIndex(phase)">{{ s.label }}</li>
            }
          </ol>
          <p class="sub" style="margin: 0">{{ cyclingLabels[phase].detail }}</p>
          @if (phase === 'done') {
            <button class="btn fill" type="button" style="align-self: flex-start" (click)="endCycling()">Terminer le cyclage</button>
          }
        </section>
      }
      @if (v.tank.co2) {
        <section class="card co2">
          <div class="row between">
            <h2 class="h2"><app-icon name="bubble" [size]="18" />CO2</h2>
            @if (v.tank.co2Target) { <span class="sub" style="margin: 0">cible {{ v.tank.co2Target }} bulles/min</span> }
          </div>
          @if (co2Last(); as r) {
            <div class="row" style="gap: 16px; flex-wrap: wrap">
              @if (r.bubblesPerMinute != null) {
                <div><p class="lbl">Débit</p><p class="big">{{ r.bubblesPerMinute }}<small> b/min</small></p></div>
              }
              @if (r.dropChecker; as d) {
                <div><p class="lbl">Drop checker</p><p class="dcv"><i [class]="d"></i>{{ dropInfo[d].label }}</p></div>
              }
              @if (co2State(); as s) {
                <span class="pill" [class.ok]="s === 'ok'" [class.wn]="s !== 'ok'">{{ s === 'ok' ? 'Dans la cible' : s === 'low' ? 'Sous la cible' : 'Au-dessus' }}</span>
              }
            </div>
            <p class="sub" style="margin: 0">Mesuré {{ ago(r.date, store.today()) }}{{ r.note ? ' · ' + r.note : '' }}</p>
            @if (r.dropChecker && r.dropChecker !== 'green') { <p class="sub" style="margin: 0; color: var(--wn)">{{ dropInfo[r.dropChecker].detail }}</p> }
          } @else {
            <p class="sub" style="margin: 0">Aucune mesure. Compte les bulles pour régler ton débit.</p>
          }
          @if (phDay(); as d) {
            <div class="est" [class.warn]="d.level === 'warn'" [class.danger]="d.level === 'danger'">
              <p><b>CO2 mesuré : ~{{ fmtN(d.mgL) }} mg/L</b> <span class="sub">(visé {{ co2Target.min }}–{{ co2Target.max }})</span> · {{ d.title }}</p>
              <p class="sub" style="margin: 0">pH {{ fmtN(d.phBefore) }}{{ d.phBeforeTime ? ' à ' + d.phBeforeTime : '' }} → {{ fmtN(d.phAfter) }}{{ d.phAfterTime ? ' à ' + d.phAfterTime : '' }}, baisse de {{ fmtN(d.drop) }} ({{ shortDate(d.date) }}). {{ d.detail }}</p>
              @if (d.suggestedBpm != null && d.suggestedBpm !== co2Last()?.bubblesPerMinute) {
                <p style="margin-top: 4px"><b>Débit conseillé : ~{{ d.suggestedBpm }} bulles/min</b> (actuellement {{ co2Last()?.bubblesPerMinute }})</p>
              }
            </div>
            @if (co2Est(); as e) { <p class="sub" style="margin: 0">Estimation KH/pH : {{ fmtN(e.mgL) }} mg/L ({{ shortDate(e.date) }}).</p> }
          } @else if (co2Est(); as e) {
            <div class="est" [class.warn]="e.level === 'warn'" [class.danger]="e.level === 'danger'">
              <p><b>CO2 estimé : {{ fmtN(e.mgL) }} mg/L</b> <span class="sub">(visé {{ co2Target.min }}–{{ co2Target.max }})</span> · {{ e.title }}</p>
              <p class="sub" style="margin: 0">D’après KH {{ fmtN(e.kh) }} et pH {{ fmtN(e.ph) }} ({{ shortDate(e.date) }}). {{ e.detail }}</p>
              @if (e.suggestedBpm != null && e.suggestedBpm !== co2Last()?.bubblesPerMinute) {
                <p style="margin-top: 4px"><b>Débit conseillé : ~{{ e.suggestedBpm }} bulles/min</b> (actuellement {{ co2Last()?.bubblesPerMinute }})</p>
              }
            </div>
          } @else {
            <p class="sub" style="margin: 0">Mesure le KH et le pH (pendant l’injection) pour estimer le CO2 dissous.</p>
          }
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <button class="btn water" type="button" (click)="counting.set(true)"><app-icon name="timer" [size]="20" />Compter les bulles</button>
            <button class="btn out" type="button" (click)="phSheet.set(true)"><app-icon name="drop" [size]="20" />pH sur la journée</button>
          </div>
          @if (co2History().length > 1) {
            <p class="sub" style="margin: 0">Précédentes : {{ co2History() }}</p>
          }
        </section>
        @if (counting()) {
          <app-co2-counter [tank]="v.tank" (closed)="counting.set(false)" />
        }
        @if (phSheet()) {
          <app-ph-day-sheet [tank]="v.tank" (closed)="phSheet.set(false)" />
        }
      }
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

        <a style="align-self: flex-start; font-size: 13px; font-weight: 600" routerLink="/import-ia" [queryParams]="{ bac: v.tank.id }">Lire une photo des tests</a>
        <div class="row between">
          <h2 class="h2">Évolution</h2>
          <div class="row legend"><i></i>Plage idéale du bac @if (marks().length) { <b class="dash"></b>Réglage modifié }</div>
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
              <app-param-chart [key]="c.key" [tests]="v.tests" [range]="c.range" [label]="c.label" [marks]="marks()" />
              @if (c.trend; as tr) {
                <p class="trend" [class.bad]="tr.daysToLimit != null && tr.daysToLimit <= 14">
                  {{ tr.perWeek > 0 ? '↗' : '↘' }} {{ tr.perWeek > 0 ? '+' : '' }}{{ fmtN(tr.perWeek) }} {{ c.unit }} par semaine
                  @if (tr.daysToLimit != null) {
                    · {{ tr.limit === 'max' ? 'plafond' : 'plancher' }} {{ tr.daysToLimit === 0 ? 'atteint' : 'dans ~' + tr.daysToLimit + ' j' }}
                  }
                </p>
              }
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
          <a class="btn out" routerLink="/import-ia" [queryParams]="{ bac: v.tank.id }"><app-icon name="upload" [size]="18" />Lire une photo des tests</a>
        </div>
      }
      <a class="fab" routerLink="/releve" [queryParams]="{ bac: v.tank.id }"><app-icon name="plus" [size]="20" [stroke]="2.2" />Relevé</a>
    }
  `,
})
export class WaterTab {
  /** Changements de réglages du matériel, repérés sur les courbes. */
  protected readonly marks = computed(() =>
    this.store.settingChanges()
      .filter((c) => c.tankId === this.id())
      .map((c) => ({ date: c.date, label: `${c.equipmentName} · ${describeChange(c)}` })),
  );
  protected readonly store = inject(AquariumStore);
  readonly id = input.required<string>();

  protected readonly ago = agoLabel;
  protected readonly shortDate = fmtShortDate;

  protected readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.id()));
  private readonly species = computed(() => this.view()?.members.map((m) => m.species) ?? []);

  protected readonly cells = computed(() => {
    const v = this.view();
    const values = v?.lastTest?.values ?? {};
    return measuredParams(v?.tests ?? []).map((key) => {
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
    const order = (k: string) => (v.alerts.some((a) => a.key === k) ? -1 : 0) * 100 + measuredParams(v.tests).indexOf(k as never);
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
          unit: def.unit,
          trend: trendOf(v.tests, key, range),
        };
      });
  });

  protected readonly fmtN = fmt;
  protected readonly dropInfo = DROP_CHECKER;
  protected readonly counting = signal(false);
  private readonly co2List = computed(() => this.store.co2Readings().filter((r) => r.tankId === this.id()));
  protected readonly co2Last = computed(() => this.co2List().filter((r) => r.bubblesPerMinute != null || r.dropChecker).at(-1));
  protected readonly phSheet = signal(false);
  /** Dernière mesure de pH sur la journée (moins de 14 jours), avec conseil de débit. */
  protected readonly phDay = computed(() => {
    const r = this.co2List().filter((x) => x.phBefore != null && x.phAfter != null).at(-1);
    if (!r || Date.now() - new Date(r.date).getTime() > 14 * 864e5) return undefined;
    const m = co2FromPhDrop(r.phBefore!, r.phAfter!);
    return m ? { ...co2Advice(m.mgL, this.co2Last()?.bubblesPerMinute), ...m, phBefore: r.phBefore!, phAfter: r.phAfter!, phBeforeTime: r.phBeforeTime, phAfterTime: r.phAfterTime, date: r.date } : undefined;
  });
  protected readonly co2State = computed(() => {
    const r = this.co2Last();
    return r?.bubblesPerMinute != null ? co2Status(r.bubblesPerMinute, this.view()?.tank.co2Target) : undefined;
  });
  protected readonly co2Target = CO2_TARGET;
  /** CO2 dissous estimé à partir du dernier KH + pH, avec conseil de débit. */
  protected readonly co2Est = computed(() => {
    const kp = latestKhPh(this.view()?.tests ?? []);
    const mg = kp && co2FromKhPh(kp.kh, kp.ph);
    if (!kp || mg == null) return undefined;
    return { ...co2Advice(mg, this.co2Last()?.bubblesPerMinute), ...kp };
  });
  protected readonly co2History = computed(() =>
    this.co2List().slice(-6, -1).reverse().filter((r) => r.bubblesPerMinute != null).map((r) => `${r.bubblesPerMinute} (${fmtShortDate(r.date)})`).join(' · '),
  );
  protected readonly cyclingLabels = CYCLING_LABELS;
  protected readonly cyclingSteps = [
    { key: 'ammonia', label: 'NH4' },
    { key: 'nitrite', label: 'NO2' },
    { key: 'waiting', label: 'NO3' },
    { key: 'done', label: 'Prêt' },
  ] as const;
  protected readonly cycling = computed(() => cyclingPhase(this.view()?.tests ?? []));

  protected stepIndex(phase: string): number {
    return ['no_data', 'ammonia', 'nitrite', 'waiting', 'done'].indexOf(phase) - 1;
  }

  protected endCycling(): void {
    const t = this.view()?.tank;
    if (t) this.store.saveTank({ ...t, cycling: false });
  }

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
