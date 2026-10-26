import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import type { Consumable, EquipmentType, StockLevel } from '../../core/models';
import { CONSUMABLE_CATEGORIES, EQUIPMENT_TYPES, STOCK_LEVELS, fmtDate } from '../../core/labels';
import { gearChecks, photoperiod, stockAlerts, warrantyEnd } from '../../core/insights';
import type { Equipment } from '../../core/models';
import { fmt } from '../../core/labels';
import { daysBetween } from '../../core/dates';
import { Icon } from '../../shared/icon';

export function equipmentIcon(type: EquipmentType): string {
  return ({ filter: 'filter', heater: 'heater', light: 'bulb', co2: 'bubble', pump: 'filter', air: 'bubble', thermometer: 'thermo', controller: 'timer', other: 'tool' } as Record<EquipmentType, string>)[type];
}

/** Résumé des caractéristiques utiles, en une ligne. */
export function equipmentSummary(e: Equipment): string {
  const parts: string[] = [];
  const l = e.light;
  if (l) {
    if (l.schedule) parts.push(`${l.schedule.on}–${l.schedule.off} (${fmt(photoperiod(l))} h)`);
    if (l.intensityPct != null) parts.push(`${l.intensityPct} %`);
    if (l.channels?.length) parts.push(l.channels.join('/'));
    if (l.par) parts.push(`PAR ${l.par}`);
  }
  if (e.filter?.flowLh) parts.push(`${e.filter.flowLh} L/h`);
  if (e.heater?.powerW) parts.push(`${e.heater.powerW} W${e.heater.setpointC ? ' · ' + fmt(e.heater.setpointC) + ' °C' : ''}`);
  if (e.co2?.schedule) parts.push(`CO2 ${e.co2.schedule.on}–${e.co2.schedule.off}`);
  if (e.specs) parts.push(e.specs);
  return parts.join(' · ');
}


/** Matériel (par bac) et consommables (stock, péremption). */
@Component({
  selector: 'app-gear',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .ic { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--wab); color: var(--wa); }
    .ic.p { background: var(--plb); color: var(--pl); }
    .nm { font-weight: 700; font-size: 15px; }
    .lv { display: flex; gap: 3px; margin-top: 8px; }
    .lv button { flex: 1; height: 30px; border-radius: 8px; border: 1px solid var(--ln); background: var(--sf); font: 600 11.5px var(--font); color: var(--mu); cursor: pointer; padding: 0 2px; }
    .lv button.on { background: var(--pl); border-color: var(--pl); color: var(--sf); }
    .lv button.on.low { background: var(--wn); border-color: var(--wn); }
    .lv button.on.empty { background: var(--dg); border-color: var(--dg); }
    .cons .li { align-items: flex-start; }
    .check-line { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--mu); }
    .check-line .dot { margin-top: 5px; color: var(--mu); }
    .check-line.ok .dot { color: var(--ok); }
    .check-line.warn { color: var(--wn); }
    .check-line.warn .dot { color: var(--wn); }
    .alert { padding: 10px 14px; font-size: 14px; display: flex; gap: 10px; align-items: center; }
    .alert.danger { background: var(--dgb); color: var(--dg); }
    .alert.warn { background: var(--wnb); color: var(--wn); }
  `,
  template: `
    <div class="page" style="gap: 16px">
      <header class="top">
        <h1 class="h1">Matériel</h1>
      </header>
      <nav class="seg" aria-label="Sections">
        <a routerLink="/materiel" [queryParams]="{ vue: 'equipements' }" [class.on]="tab() === 'equipements'">Équipements</a>
        <a routerLink="/materiel" [queryParams]="{ vue: 'consommables' }" [class.on]="tab() === 'consommables'">Consommables</a>
      </nav>

      @if (tab() === 'equipements') {
        @for (g of groups(); track g.title) {
          <section class="stack" style="gap: 8px">
            <h2 class="h2">{{ g.title }} <span class="sub" style="margin: 0; font-weight: 500">{{ g.items.length }}</span></h2>
            @for (c of g.checks; track c.title) {
              <p class="check-line" [class.warn]="c.level === 'warn'" [class.ok]="c.level === 'ok'">
                <span class="dot"></span><span><b>{{ c.title }}</b>{{ c.level !== 'ok' ? ' — ' + c.detail : '' }}</span>
              </p>
            }
            <div class="card">
              @for (e of g.items; track e.id) {
                <a class="li" [routerLink]="['/materiel/equipement', e.id]">
                  <span class="ic" [class.p]="e.type === 'light' || e.type === 'co2'"><app-icon [name]="icon(e.type)" [size]="22" /></span>
                  <div class="grow">
                    <p class="nm">{{ e.name }}</p>
                    <p class="sub">{{ types[e.type] }}{{ e.brand ? ' · ' + e.brand : '' }}{{ e.model ? ' ' + e.model : '' }}</p>
                    @if (summary(e); as s) { <p class="sub" style="color: var(--ink)">{{ s }}</p> }
                    @if (warranty(e); as w) {
                      <span class="chip" [class.o]="w.soon" [class.p]="!w.soon && !w.over" style="margin-top: 6px">{{ w.label }}</span>
                    }
                  </div>
                  <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
                </a>
              }
            </div>
          </section>
        } @empty {
          <div class="card empty">
            <span class="ph sa" style="width: 64px; height: 64px"><app-icon name="tool" [size]="30" /></span>
            <p>Note ton filtre, ton chauffage, ton éclairage… avec leur date d’achat pour suivre les garanties.</p>
          </div>
        }
        <a class="fab" routerLink="/materiel/equipement/nouveau"><app-icon name="plus" [size]="20" [stroke]="2.2" />Équipement</a>
      } @else {
        @for (a of alerts(); track a.id + a.title) {
          @if (a.kind === 'consumable') {
            <p class="card alert" [class.danger]="a.level === 'danger'" [class.warn]="a.level === 'warn'"><app-icon name="warn" [size]="18" /><span><b>{{ a.title }}</b> — {{ a.detail }}</span></p>
          }
        }
        @if (consumables().length) {
          <div class="card cons">
            @for (c of consumables(); track c.id) {
              <div class="li">
                <span class="ic" [class.p]="c.category === 'fertilizer' || c.category === 'food'"><app-icon name="box" [size]="22" /></span>
                <div class="grow">
                  <a class="nm" [routerLink]="['/materiel/consommable', c.id]" style="color: inherit">{{ c.name }}</a>
                  <p class="sub">
                    {{ categories[c.category] }}{{ c.brand ? ' · ' + c.brand : '' }}
                    @if (c.expiryDate) { · périme le {{ date(c.expiryDate) }} }
                  </p>
                  <div class="lv" role="group" [attr.aria-label]="'Niveau de ' + c.name">
                    @for (l of levels; track l[0]) {
                      <button type="button" [class.on]="c.level === l[0]" [class.low]="l[0] === 'low'" [class.empty]="l[0] === 'empty'"
                        [attr.aria-pressed]="c.level === l[0]" (click)="setLevel(c, l[0])">{{ l[1] }}</button>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="card empty">
            <span class="ph sa" style="width: 64px; height: 64px"><app-icon name="box" [size]="30" /></span>
            <p>Nourriture, engrais, tests… Indique le niveau et la date de péremption : l’app te prévient quand il faut racheter.</p>
          </div>
        }
        <a class="fab" routerLink="/materiel/consommable/nouveau"><app-icon name="plus" [size]="20" [stroke]="2.2" />Consommable</a>
      }
    </div>
  `,
})
export class GearPage {
  private readonly store = inject(AquariumStore);
  /** `?vue=consommables`. */
  readonly vue = input<string>();

  protected readonly types = EQUIPMENT_TYPES;
  protected readonly categories = CONSUMABLE_CATEGORIES;
  protected readonly levels = Object.entries(STOCK_LEVELS) as [StockLevel, string][];
  protected readonly icon = equipmentIcon;
  protected readonly date = fmtDate;

  protected readonly tab = computed(() => (this.vue() === 'consommables' ? 'consommables' : 'equipements'));

  protected readonly groups = computed(() => {
    const tanks = this.store.activeTanks();
    const all = [...this.store.equipment()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const groups = tanks.map((t) => {
      const items = all.filter((e) => e.tankId === t.id);
      return { title: t.name, items, checks: gearChecks(t, items) };
    });
    const known = new Set(tanks.map((t) => t.id));
    groups.push({ title: 'En réserve', items: all.filter((e) => !e.tankId || !known.has(e.tankId)), checks: [] });
    return groups.filter((g) => g.items.length);
  });

  protected readonly consumables = computed(() => {
    const order: Record<StockLevel, number> = { empty: 0, low: 1, half: 2, full: 3 };
    return [...this.store.consumables()].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name, 'fr'));
  });

  protected readonly alerts = computed(() => stockAlerts(this.store.consumables(), this.store.equipment(), this.store.today()));

  protected warranty(e: { purchaseDate?: string; warrantyMonths?: number }): { label: string; soon: boolean; over: boolean } | undefined {
    const end = warrantyEnd(e);
    if (!end) return undefined;
    const days = daysBetween(this.store.today(), end);
    if (days < 0) return { label: 'Hors garantie', soon: false, over: true };
    return { label: `Garantie jusqu’au ${fmtDate(end)}`, soon: days <= 30, over: false };
  }

  protected readonly summary = equipmentSummary;

  protected setLevel(c: Consumable, level: StockLevel): void {
    this.store.setConsumableLevel(c.id, level);
  }
}
