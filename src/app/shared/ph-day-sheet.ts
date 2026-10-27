import type { ElementRef} from '@angular/core';
import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { Tank } from '../core/models';
import { AquariumStore } from '../core/store';
import { GearStore } from '../core/stores/gear.store';
import { WaterStore } from '../core/stores/water.store';
import { CO2_TARGET, co2Advice, co2FromPhDrop } from '../core/insights';
import { fmt, parseNumber } from '../core/labels';
import { Icon } from './icon';
import { ModalFocus } from './modal-focus';
import { GearRepo } from '../core/data/gear.repo';

/**
 * Mesure du CO2 par la baisse de pH sur la journée : pH avant l'injection, puis pH en fin d'éclairage.
 * Plus fiable que l'estimation KH/pH, car indépendante du KH.
 */
@Component({
  selector: 'app-ph-day-sheet',
  imports: [Icon, ModalFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(8, 14, 11, .5); display: flex; align-items: flex-end; justify-content: center; }
    .sheet { width: 100%; max-width: 520px; max-height: 100dvh; overflow-y: auto; background: var(--bg); border-radius: 14px 14px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; outline: none; }
    @media (min-width: 640px) { .backdrop { align-items: center; } .sheet { border-radius: 14px; } }
    .res { padding: 2px 0 2px 12px; border-left: 3px solid var(--ok); display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
    .res.warn { border-left-color: var(--wn); }
    .res.danger { border-left-color: var(--dg); }
    ol { margin: 0; padding-left: 18px; font-size: 13px; color: var(--mu); display: flex; flex-direction: column; gap: 4px; }
  `,
  template: `
    <div class="backdrop" role="presentation" (click)="closed.emit()">
      <div #root class="sheet" appModal role="dialog" aria-modal="true" aria-labelledby="ph-title" tabindex="-1"
        (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()">
        <div class="row between">
          <h2 id="ph-title" class="h2" style="font-size: 18px">pH sur la journée</h2>
          <button class="iconbtn" type="button" aria-label="Fermer" (click)="closed.emit()"><app-icon name="close" /></button>
        </div>
        <ol>
          <li>Mesure le pH juste avant l’ouverture du CO2{{ co2On() ? ' (' + co2On() + ')' : '' }}. Mieux encore : un verre d’eau du bac laissé 24 h à l’air.</li>
          <li>Mesure-le à nouveau en fin d’éclairage{{ lightOff() ? ' (avant ' + lightOff() + ')' : '' }}, quand le CO2 est au plus haut.</li>
          <li>Une baisse d’environ 1 point correspond à ~30 mg/L de CO2.</li>
        </ol>
        <div class="form-grid">
          <div class="field">
            <label for="ph-b">pH avant CO2</label>
            <input id="ph-b" class="num" inputmode="decimal" [value]="before()" (input)="before.set(val($event))" />
          </div>
          <div class="field">
            <label for="ph-bt">Heure</label>
            <input id="ph-bt" type="time" [value]="beforeTime()" (input)="beforeTime.set(val($event))" />
          </div>
          <div class="field">
            <label for="ph-a">pH fin d’éclairage</label>
            <input id="ph-a" class="num" inputmode="decimal" [value]="after()" (input)="after.set(val($event))" />
          </div>
          <div class="field">
            <label for="ph-at">Heure</label>
            <input id="ph-at" type="time" [value]="afterTime()" (input)="afterTime.set(val($event))" />
          </div>
        </div>
        @if (result(); as r) {
          <div class="res" [class.warn]="r.level === 'warn'" [class.danger]="r.level === 'danger'">
            <p><b>Baisse de {{ fmt(r.drop) }} point · ~{{ fmt(r.mgL) }} mg/L</b> <span class="sub">(visé {{ target.min }}–{{ target.max }})</span></p>
            <p class="sub" style="margin: 0">{{ r.title }}. {{ r.detail }}</p>
          </div>
        }
        <button class="btn fill" type="button" [disabled]="!result()" (click)="save()"><app-icon name="check" [size]="20" />Enregistrer</button>
      </div>
    </div>
  `,
})
export class PhDaySheet {
  private readonly store = inject(AquariumStore);
  private readonly gearStore = inject(GearStore);
  private readonly waterStore = inject(WaterStore);
  protected readonly gearRepo = inject(GearRepo);
  readonly tank = input.required<Tank>();
  readonly closed = output();

  protected readonly fmt = fmt;
  protected readonly target = CO2_TARGET;
  protected readonly val = (e: Event) => (e.target as HTMLInputElement).value;
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  private readonly gear = computed(() => this.gearStore.equipment().filter((e) => e.tankId === this.tank().id));
  protected readonly co2On = computed(() => this.gear().find((e) => e.co2?.schedule)?.co2?.schedule?.on ?? '');
  protected readonly lightOff = computed(() => this.gear().find((e) => e.light?.schedule)?.light?.schedule?.off ?? '');

  protected readonly before = signal('');
  protected readonly after = signal('');
  protected readonly beforeTime = signal('');
  protected readonly afterTime = signal('');

  protected readonly result = computed(() => {
    const b = parseNumber(this.before());
    const a = parseNumber(this.after());
    const r = b != null && a != null ? co2FromPhDrop(b, a) : undefined;
    if (!r) return undefined;
    const bpm = this.waterStore.co2Readings().filter((x) => x.tankId === this.tank().id && x.bubblesPerMinute != null).at(-1)?.bubblesPerMinute;
    return { ...co2Advice(r.mgL, bpm), drop: r.drop };
  });

  constructor() {
    afterNextRender(() => {
      this.beforeTime.set(this.co2On());
      this.root()?.nativeElement.focus();
    });
  }

  protected async save(): Promise<void> {
    await this.gearRepo.addCo2Reading({
      tankId: this.tank().id,
      date: new Date().toISOString(),
      phBefore: parseNumber(this.before()),
      phAfter: parseNumber(this.after()),
      phBeforeTime: this.beforeTime() || undefined,
      phAfterTime: this.afterTime() || undefined,
    });
    this.closed.emit();
  }
}
