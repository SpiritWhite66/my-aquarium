import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import type { DoseUnit, MaintenanceTask } from '../core/models';
import { AquariumStore } from '../core/store';
import { GearStore } from '../core/stores/gear.store';
import { CareStore } from '../core/stores/care.store';
import { DOSE_UNITS, parseNumber } from '../core/labels';
import { Icon } from './icon';
import { ModalFocus } from './modal-focus';
import { localDay } from '../core/dates';
import { CareRepo } from '../core/data/care.repo';
import { must } from '../core/assert';

interface Row {
  product: string;
  amount: string;
  unit: DoseUnit;
  consumableId?: string;
}

/** Saisie des doses d'engrais : une ligne par produit, préremplie avec la dernière fertilisation du bac. */
@Component({
  selector: 'app-dose-sheet',
  imports: [Icon, ModalFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(8, 14, 11, .5); display: flex; align-items: flex-end; justify-content: center; }
    .sheet { width: 100%; max-width: 520px; max-height: 100dvh; overflow-y: auto; background: var(--bg); border-radius: 14px 14px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; outline: none; }
    @media (min-width: 640px) { .backdrop { align-items: center; } .sheet { border-radius: 14px; } }
    .dose { display: grid; grid-template-columns: 1fr 1fr 36px; gap: 6px; align-items: stretch; padding-bottom: 10px; border-bottom: 1px solid var(--ln); }
    .dose .field:first-child { grid-column: 1 / 3; }
    .dose .rm { grid-column: 3; grid-row: 1; }
    .dose .field { padding: 6px 10px; }
    .dose .field input, .dose .field select { font-size: 15px; }
    .rm { border: 0; background: none; color: var(--mu); cursor: pointer; display: grid; place-items: center; }
    .add { align-self: flex-start; font-size: 13px; font-weight: 600; border: 0; background: none; color: var(--pl); cursor: pointer; padding: 0; text-decoration: underline; }
  `,
  template: `
    <div class="backdrop" role="presentation" (click)="closed.emit()">
      <div #root class="sheet" appModal role="dialog" aria-modal="true" aria-labelledby="dose-title" tabindex="-1"
        (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()">
        <div class="row between">
          <h2 id="dose-title" class="h2" style="font-size: 18px">Engrais</h2>
          <button class="iconbtn" type="button" aria-label="Fermer" (click)="closed.emit()"><app-icon name="close" /></button>
        </div>
        <p class="sub" style="margin: 0">{{ tankName() }}{{ lastLabel() ? ' · dernière fois ' + lastLabel() : '' }}</p>
        <datalist id="dose-products">
          @for (p of products(); track p) { <option [value]="p"></option> }
        </datalist>
        @for (r of rows(); track $index; let i = $index) {
          <div class="dose">
            <div class="field">
              <label [for]="'d-p' + i">Produit</label>
              <input [id]="'d-p' + i" list="dose-products" [value]="r.product" (input)="update(i, { product: val($event) })" placeholder="Engrais NPK" />
            </div>
            <div class="field">
              <label [for]="'d-a' + i">Dose</label>
              <input [id]="'d-a' + i" class="num" inputmode="decimal" [value]="r.amount" (input)="update(i, { amount: val($event) })" />
            </div>
            <div class="field">
              <label [for]="'d-u' + i">Unité</label>
              <select [id]="'d-u' + i" (change)="update(i, { unit: $any(val($event)) })">
                @for (u of units; track u[0]) { <option [value]="u[0]" [selected]="u[0] === r.unit">{{ u[1] }}</option> }
              </select>
            </div>
            <button class="rm" type="button" [attr.aria-label]="'Retirer ' + (r.product || 'la ligne')" (click)="remove(i)"><app-icon name="close" [size]="18" /></button>
          </div>
        }
        <button class="add" type="button" (click)="add()">Ajouter un produit</button>
        <button class="btn fill" type="button" [disabled]="!valid().length" (click)="save()"><app-icon name="check" [size]="20" />C’est fait</button>
      </div>
    </div>
  `,
})
export class DoseSheet {
  private readonly store = inject(AquariumStore);
  private readonly gearStore = inject(GearStore);
  private readonly careStore = inject(CareStore);
  protected readonly careRepo = inject(CareRepo);
  readonly tankId = input.required<string>();
  /** Tâche de fertilisation à valider (facultatif). */
  readonly task = input<MaintenanceTask>();
  readonly closed = output();

  protected readonly units = Object.entries(DOSE_UNITS) as [DoseUnit, string][];
  protected readonly val = (e: Event) => (e.target as HTMLInputElement).value;
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  protected readonly tankName = computed(
    () => this.store.tanks().find((t) => t.id === this.tankId())?.name ?? '',
  );
  private readonly fertilizers = computed(() =>
    this.gearStore.consumables().filter((c) => c.category === 'fertilizer'),
  );
  private readonly doseLogs = computed(() =>
    this.careStore
      .logs()
      .filter((l) => l.tankId === this.tankId() && l.type === 'fertilize' && l.details?.product),
  );

  /** Produits proposés : engrais du stock, puis produits déjà dosés. */
  protected readonly products = computed(() => [
    ...new Set([
      ...this.fertilizers().map((c) => c.name),
      ...this.doseLogs().map((l) => must(must(l.details).product)),
    ]),
  ]);

  /** Dernière session de fertilisation (même jour que la plus récente dose). */
  private readonly lastSession = computed(() => {
    const logs = this.doseLogs();
    const day = logs[0] && localDay(logs[0].date);
    // `logs` va du plus récent au plus ancien : on remet les produits dans l'ordre de saisie.
    return day ? logs.filter((l) => localDay(l.date) === day).reverse() : [];
  });
  protected readonly lastLabel = computed(() => {
    const d = this.lastSession()[0]?.date;
    return d
      ? new Date(d).toLocaleDateString('fr-FR', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      : '';
  });

  protected readonly rows = linkedSignal<Row[]>(() => {
    const last = this.lastSession();
    if (last.length) {
      return last.map((l) => ({
        product: must(must(l.details).product),
        amount: l.details?.amount != null ? String(l.details.amount).replace('.', ',') : '',
        unit: l.details?.unit ?? 'ml',
        consumableId: l.details?.consumableId,
      }));
    }
    const f = this.fertilizers().at(0);
    return [{ product: f?.name ?? '', amount: '', unit: 'ml', consumableId: f?.id }];
  });

  protected readonly valid = computed(() => this.rows().filter((r) => r.product.trim()));

  constructor() {
    afterNextRender(() => this.root()?.nativeElement.focus());
  }

  protected update(i: number, patch: Partial<Row>): void {
    this.rows.update((rows) =>
      rows.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (patch.product !== undefined)
          next.consumableId = this.fertilizers().find((c) => c.name === patch.product)?.id;
        return next;
      }),
    );
  }
  protected add(): void {
    this.rows.update((rows) => [
      ...rows,
      { product: '', amount: '', unit: rows.at(-1)?.unit ?? 'ml' },
    ]);
  }
  protected remove(i: number): void {
    this.rows.update((rows) => rows.filter((_, j) => j !== i));
  }

  protected async save(): Promise<void> {
    const doses = this.valid().map((r) => ({
      product: r.product.trim(),
      amount: parseNumber(r.amount),
      unit: r.unit,
      consumableId: r.consumableId,
    }));
    await this.careRepo.logDoses(this.tankId(), doses, this.task());
    this.closed.emit();
  }
}
