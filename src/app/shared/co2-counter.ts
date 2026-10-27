import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { DropChecker, Tank } from '../core/models';
import { AquariumStore } from '../core/store';
import { WaterStore } from '../core/stores/water.store';
import {
  DROP_CHECKER,
  bpmFromTaps,
  co2Advice,
  co2FromKhPh,
  co2Status,
  latestKhPh,
} from '../core/insights';
import { fmt } from '../core/labels';
import { parseNumber } from '../core/labels';
import { Icon } from './icon';
import { ModalFocus } from './modal-focus';
import { GearRepo } from '../core/data/gear.repo';
import { TankRepo } from '../core/data/tank.repo';
import { browserNav } from '../core/browser';

/**
 * Compteur de bulles CO2 : on tape à chaque bulle dans le compte-bulles,
 * l'app mesure les intervalles et calcule le débit en bulles par minute.
 */
@Component({
  selector: 'app-co2-counter',
  imports: [Icon, ModalFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(8, 14, 11, .5); display: flex; align-items: flex-end; justify-content: center; }
    .sheet { width: 100%; max-width: 520px; max-height: 100dvh; overflow-y: auto; background: var(--bg); border-radius: 14px 14px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; outline: none; }
    @media (min-width: 640px) { .backdrop { align-items: center; } .sheet { border-radius: 14px; } }
    .tap { width: 190px; height: 190px; border-radius: 95px; border: 0; margin: 4px auto; background: var(--wa); color: var(--on-wa); font: 700 20px var(--font); cursor: pointer; display: grid; place-items: center; box-shadow: var(--shadow); touch-action: manipulation; user-select: none; transition: transform .06s; }
    .tap:active { transform: scale(.96); }
    .tap small { display: block; font-size: 13px; font-weight: 600; opacity: .8; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; }
    .stats div { background: var(--sf); border: 1px solid var(--ln); border-radius: 14px; padding: 8px; }
    .stats b { display: block; font: 600 24px var(--mono); }
    .stats span { font-size: 11px; font-weight: 600; color: var(--mu); }
    .dc { display: flex; gap: 6px; }
    .dc button { flex: 1; height: 44px; border-radius: 12px; border: 2px solid var(--ln); background: var(--sf); font: 600 13px var(--font); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .dc button.on { border-color: var(--ink); }
    .dc i { width: 14px; height: 14px; border-radius: 7px; }
    .hint { font-size: 13px; }
  `,
  template: `
    <div class="backdrop" role="presentation" (click)="closed.emit()">
      <div #root class="sheet" appModal role="dialog" aria-modal="true" aria-labelledby="co2-title" tabindex="-1"
        (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()">
        <div class="row between">
          <h2 id="co2-title" class="h2" style="font-size: 18px">Compteur de bulles</h2>
          <button class="iconbtn" type="button" aria-label="Fermer" (click)="closed.emit()"><app-icon name="close" /></button>
        </div>
        @if (advice(); as a) {
          <p class="pill" [class.ok]="a.level === 'ok'" [class.wn]="a.level === 'warn'" [class.dg]="a.level === 'danger'" style="align-self: flex-start; height: auto; padding: 6px 12px; white-space: normal">
            CO2 estimé {{ fmtN(a.mgL) }} mg/L · {{ a.title }}{{ a.suggestedBpm ? ' → vise ~' + a.suggestedBpm + ' bulles/min' : '' }}
          </p>
        }
        <p class="sub hint" style="margin: 0">Regarde ton compte-bulles et tape le bouton à chaque bulle. Au moins 10 bulles pour une mesure fiable.</p>

        <button class="tap" type="button" (click)="tap()" aria-describedby="co2-live">
          <span>Bulle<small>{{ taps().length ? taps().length + ' comptée' + (taps().length > 1 ? 's' : '') : 'touche pour démarrer' }}</small></span>
        </button>

        <div class="stats" id="co2-live" aria-live="polite">
          <div><b>{{ taps().length }}</b><span>bulles</span></div>
          <div><b>{{ elapsed() }}</b><span>secondes</span></div>
          <div><b>{{ bpm() ?? '—' }}</b><span>bulles/min</span></div>
        </div>
        @if (status(); as s) {
          <p class="pill" [class.ok]="s === 'ok'" [class.wn]="s !== 'ok'" style="align-self: center">
            {{ s === 'ok' ? 'Dans la cible' : s === 'low' ? 'Sous la cible' : 'Au-dessus de la cible' }} ({{ tank().co2Target }} bulles/min)
          </p>
        }

        <div class="row" style="gap: 8px">
          <button class="btn out" type="button" [disabled]="!taps().length" (click)="reset()">Recommencer</button>
          <div class="field grow" style="padding: 4px 10px">
            <label for="co2-manual">Ou saisis le débit</label>
            <input id="co2-manual" class="num" inputmode="numeric" placeholder="bulles/min" [value]="manual()" (input)="manual.set($any($event.target).value)" />
          </div>
        </div>

        <div class="stack" style="gap: 6px">
          <p class="lbl">Drop checker (facultatif)</p>
          <div class="dc" role="group" aria-label="Couleur du drop checker">
            @for (c of colors; track c.key) {
              <button type="button" [class.on]="drop() === c.key" [attr.aria-pressed]="drop() === c.key" (click)="drop.set(drop() === c.key ? undefined : c.key)">
                <i [style.background]="c.css"></i>{{ dropInfo[c.key].label }}
              </button>
            }
          </div>
          @if (drop(); as d) { <p class="sub" style="margin: 0">{{ dropInfo[d].detail }}</p> }
        </div>

        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn fill grow" type="button" [disabled]="!canSave()" (click)="save(false)"><app-icon name="check" [size]="20" />Enregistrer</button>
          @if (value() != null) {
            <button class="btn ton" type="button" (click)="save(true)">Enregistrer comme cible</button>
          }
        </div>
      </div>
    </div>
  `,
})
export class Co2Counter {
  private readonly store = inject(AquariumStore);
  private readonly waterStore = inject(WaterStore);
  protected readonly gearRepo = inject(GearRepo);
  protected readonly tankRepo = inject(TankRepo);
  readonly tank = input.required<Tank>();
  readonly closed = output();

  protected readonly dropInfo = DROP_CHECKER;
  protected readonly colors: { key: DropChecker; css: string }[] = [
    { key: 'blue', css: '#2f6fd6' },
    { key: 'green', css: '#2f9e55' },
    { key: 'yellow', css: '#e3c22b' },
  ];

  protected readonly taps = signal<number[]>([]);
  protected readonly manual = signal('');
  protected readonly drop = signal<DropChecker | undefined>(undefined);
  private readonly now = signal(Date.now());
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  protected readonly elapsed = computed(() => {
    const first = this.taps()[0];
    return first === undefined ? 0 : Math.round((this.now() - first) / 1000);
  });
  protected readonly bpm = computed(() => bpmFromTaps(this.taps()));
  /** Valeur retenue : la saisie manuelle prime sur le comptage. */
  protected readonly value = computed(() => {
    const m = parseNumber(this.manual());
    return m != null && m > 0 ? Math.round(m) : this.taps().length >= 5 ? this.bpm() : undefined;
  });
  protected readonly status = computed(() => {
    const v = this.value();
    return v == null ? undefined : co2Status(v, this.tank().co2Target);
  });
  protected readonly fmtN = fmt;
  protected readonly advice = computed(() => {
    const tests = this.waterStore.waterTests().filter((t) => t.tankId === this.tank().id);
    const kp = latestKhPh(tests);
    const mg = kp && co2FromKhPh(kp.kh, kp.ph);
    if (mg == null) return undefined;
    const last = this.waterStore
      .co2Readings()
      .filter((r) => r.tankId === this.tank().id)
      .at(-1)?.bubblesPerMinute;
    return co2Advice(mg, last);
  });
  protected readonly canSave = computed(() => this.value() != null || !!this.drop());

  constructor() {
    afterNextRender(() => this.root()?.nativeElement.focus());
    const timer = setInterval(() => {
      this.now.set(Date.now());
    }, 500);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }

  protected tap(): void {
    const t = Date.now();
    this.now.set(t);
    this.taps.update((list) => [...list, t]);
    browserNav().vibrate?.(15);
  }

  protected reset(): void {
    this.taps.set([]);
  }

  protected async save(asTarget: boolean): Promise<void> {
    const bpm = this.value();
    await this.gearRepo.addCo2Reading({
      tankId: this.tank().id,
      date: new Date().toISOString(),
      bubblesPerMinute: bpm,
      dropChecker: this.drop(),
      note:
        this.taps().length >= 5 && !parseNumber(this.manual())
          ? `${this.taps().length} bulles en ${this.elapsed()} s`
          : undefined,
    });
    if (asTarget && bpm != null) await this.tankRepo.saveTank({ ...this.tank(), co2Target: bpm });
    this.closed.emit();
  }
}
