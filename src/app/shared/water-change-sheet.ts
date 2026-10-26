import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, linkedSignal, output, viewChild } from '@angular/core';
import type { MaintenanceTask } from '../core/models';
import { AquariumStore } from '../core/store';
import { afterWaterChange, percentFromLabel } from '../core/insights';
import { idealRange, levelOf } from '../core/rules';
import { fmt, parseNumber } from '../core/labels';
import { Icon } from './icon';
import { ModalFocus } from './modal-focus';
import { CareRepo } from '../core/data/care.repo';

/** Validation d'un changement d'eau : volume changé et estimation des nitrates après. */
@Component({
  selector: 'app-water-change-sheet',
  imports: [Icon, ModalFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(8, 14, 11, .5); display: flex; align-items: flex-end; justify-content: center; }
    .sheet { width: 100%; max-width: 520px; background: var(--bg); border-radius: 14px 14px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; outline: none; }
    @media (min-width: 640px) { .backdrop { align-items: center; } .sheet { border-radius: 14px; } }
    .est { padding: 12px 14px; display: flex; align-items: center; gap: 10px; font-size: 15px; }
    .est b { font-family: var(--mono); }
    .pcts { display: flex; gap: 6px; flex-wrap: wrap; }
    .pcts button { height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--ln); background: var(--sf); font: 600 13px var(--font); cursor: pointer; }
    .pcts .on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  `,
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div #root class="sheet" appModal role="dialog" aria-modal="true" aria-labelledby="wc-title" tabindex="-1"
        (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()">
        <div class="row between">
          <h2 id="wc-title" class="h2" style="font-size: 18px">Changement d’eau</h2>
          <button class="iconbtn" type="button" aria-label="Fermer" (click)="closed.emit()"><app-icon name="close" /></button>
        </div>
        <p class="sub" style="margin: 0">{{ tankName() }} · {{ volume() }} L</p>
        <div class="pcts" role="group" aria-label="Pourcentage changé">
          @for (p of presets; track p) {
            <button type="button" [class.on]="percent() === p" [attr.aria-pressed]="percent() === p" (click)="percent.set(p)">{{ p }} %</button>
          }
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="wc-pct">Pourcentage</label>
            <input id="wc-pct" class="num" inputmode="numeric" [value]="percent()" (input)="percent.set(clamp($any($event.target).value))" />
          </div>
          <div class="field">
            <label for="wc-l">Litres changés</label>
            <input id="wc-l" class="num" inputmode="decimal" [value]="liters()" (input)="setLiters($any($event.target).value)" />
          </div>
        </div>
        @if (estimate(); as e) {
          <div class="card est" [class.warn]="e.level !== 'ok'">
            <app-icon name="drop" [size]="20" />
            <span>Nitrates : <b>{{ e.before }}</b> → environ <b>{{ e.after }}</b> mg/L</span>
          </div>
        }
        <button class="btn fill" type="button" (click)="confirm()"><app-icon name="check" [size]="20" />C’est fait</button>
      </div>
    </div>
  `,
})
export class WaterChangeSheet {
  private readonly store = inject(AquariumStore);
  protected readonly careRepo = inject(CareRepo);
  readonly task = input.required<MaintenanceTask>();
  readonly closed = output<void>();

  protected readonly presets = [10, 20, 30, 40, 50];
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  private readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.task().tankId));
  protected readonly tankName = computed(() => this.view()?.tank.name ?? '');
  protected readonly volume = computed(() => {
    const t = this.view()?.tank;
    return t ? (t.volumeNet ?? t.volumeGross) : 0;
  });
  protected readonly percent = linkedSignal(() => percentFromLabel(this.task().label));
  protected readonly liters = computed(() => fmt(Math.round(this.volume() * this.percent()) / 100));

  protected readonly estimate = computed(() => {
    const v = this.view();
    const no3 = v?.lastTest?.values.no3;
    if (no3 == null || !v) return undefined;
    const after = afterWaterChange(no3, this.percent() / 100);
    const range = idealRange('no3', v.members.map((m) => m.species), v.tank);
    return { before: fmt(no3), after: fmt(after), level: levelOf('no3', after, range) };
  });

  constructor() {
    afterNextRender(() => this.root()?.nativeElement.focus());
  }

  protected clamp(raw: string): number {
    const n = Math.round(parseNumber(raw) ?? 0);
    return Math.min(100, Math.max(0, n));
  }

  protected setLiters(raw: string): void {
    const l = parseNumber(raw);
    if (l != null && this.volume()) this.percent.set(Math.min(100, Math.round((l / this.volume()) * 100)));
  }

  protected async confirm(): Promise<void> {
    const liters = Math.round(this.volume() * this.percent()) / 100;
    const e = this.estimate();
    await this.careRepo.completeTask(
      this.task(),
      `${this.percent()} % (${fmt(liters)} L)${e ? ` · NO3 estimé ${e.after} mg/L` : ''}`,
      { waterChangedLiters: liters },
    );
    this.closed.emit();
  }
}
