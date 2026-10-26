import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { AquariumStore } from '../../core/store';
import type { ParamKey } from '../../core/models';
import { EXTRA_PARAMS, MAIN_PARAMS, PARAM_BY_KEY, idealRange, levelOf, measuredParams } from '../../core/rules';
import { fmt, fmtRange, fmtShortDate, parseNumber } from '../../core/labels';
import { Icon } from '../../shared/icon';

/** Saisie rapide d'un relevé : valeurs précédentes en indication, contrôle immédiat de la plage. */
@Component({
  selector: 'app-reading',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .head { padding: 14px 0 8px; position: sticky; top: 0; background: var(--bg); z-index: 2; }
    .prev { font-size: 11px; color: var(--mu); font-family: var(--mono); }
    .field.danger { border-color: var(--dg); }
    .checks { display: flex; flex-wrap: wrap; gap: 8px; }
    .checks .pill { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 8px; }
    .tank select { font: 700 15px var(--font); border: 0; background: transparent; padding: 0; }
  `,
  template: `
    <div class="page" style="max-width: 640px; gap: 12px">
      <header class="row head">
        <button class="iconbtn" type="button" aria-label="Fermer" (click)="location.back()"><app-icon name="close" /></button>
        <div class="grow">
          <h1 style="font-size: 20px; font-weight: 700">{{ editing() ? 'Corriger le relevé' : 'Nouveau relevé' }}</h1>
          <label class="sub tank">
            <span class="sr-only">Bac</span>
            <select (change)="tankId.set($any($event.target).value)">
              @for (v of store.tankViews(); track v.tank.id) {
                <option [value]="v.tank.id" [selected]="v.tank.id === tankId()">{{ v.tank.name }}</option>
              }
            </select>
          </label>
        </div>
        <button class="btn fill" type="button" [disabled]="!hasValue()" (click)="save()">Enregistrer</button>
      </header>

      @if (prevDate()) {
        <p class="sub">En gris : valeur du relevé précédent ({{ prevDate() }}). Les champs vides sont ignorés.</p>
      }

      <form class="form-grid" (submit)="$event.preventDefault(); save()">
        @for (f of fields(); track f.key) {
          <div class="field" [class.warn]="f.level === 'warn'" [class.danger]="f.level === 'danger'">
            <label [for]="'p-' + f.key">
              <span>{{ f.label }}</span>
              @if (f.prev !== undefined) { <span class="prev">{{ f.prev }}</span> }
            </label>
            <input [id]="'p-' + f.key" class="num" inputmode="decimal" autocomplete="off" [placeholder]="f.prev ?? ''"
              [value]="raw()[f.key] ?? ''" (input)="set(f.key, $any($event.target).value)" />
          </div>
        }
        <button type="submit" hidden></button>
      </form>
      @if (hiddenExtra().length) {
        <button class="btn out" type="button" style="align-self: flex-start" (click)="showExtra.set(true)">
          <app-icon name="plus" [size]="18" />Autres paramètres ({{ hiddenExtra().join(', ') }})
        </button>
      }

      @if (checks().length) {
        <div class="checks" aria-live="polite">
          @for (c of checks(); track c.key) {
            <span class="pill" [class.ok]="c.level === 'ok'" [class.wn]="c.level === 'warn'" [class.dg]="c.level === 'danger'">{{ c.text }}</span>
          }
        </div>
      }

      <div class="field">
        <label for="when">Date et heure du test</label>
        <input id="when" type="datetime-local" [value]="when()" [max]="nowLocal" (input)="when.set($any($event.target).value)" />
      </div>

      <div class="field">
        <label for="note">Note</label>
        <input id="note" [value]="note()" (input)="note.set($any($event.target).value)" placeholder="Bandelettes, après changement d’eau…" />
      </div>
    </div>
  `,
})
export class ReadingPage {
  protected readonly store = inject(AquariumStore);
  protected readonly location = inject(Location);

  /** `?bac=` dans l'URL. */
  readonly bac = input<string>();
  /** `?edit=` : identifiant du relevé à corriger. */
  readonly edit = input<string>();

  protected readonly nowLocal = toLocalInput(new Date().toISOString());
  protected readonly when = signal(this.nowLocal);
  protected readonly editing = computed(() => this.store.waterTests().find((t) => t.id === this.edit()));
  private loadedEdit = false;

  protected readonly tankId = signal('');
  protected readonly raw = signal<Partial<Record<ParamKey, string>>>({});
  protected readonly note = signal('');
  /** Affiche aussi Fe, K, Mg et conductivité, même jamais mesurés. */
  protected readonly showExtra = signal(false);
  protected readonly hiddenExtra = computed(() => {
    const shown = new Set(this.fields().map((f) => f.key));
    return EXTRA_PARAMS.filter((k) => !shown.has(k)).map((k) => PARAM_BY_KEY[k].short);
  });

  private readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.tankId()));
  private readonly species = computed(() => this.view()?.members.map((m) => m.species) ?? []);
  protected readonly prevDate = computed(() => {
    const d = this.view()?.lastTest?.date;
    return d ? fmtShortDate(d) : '';
  });

  protected readonly fields = computed(() => {
    const last = this.view()?.lastTest?.values ?? {};
    const keys = this.showExtra() ? [...MAIN_PARAMS, ...EXTRA_PARAMS] : measuredParams(this.view()?.tests ?? []);
    return keys.map((key) => {
      const def = PARAM_BY_KEY[key];
      const value = parseNumber(this.raw()[key] ?? '');
      return {
        key,
        label: `${def.short}${def.unit ? ' ' + def.unit : ''}`,
        prev: last[key] != null ? fmt(last[key]) : undefined,
        level: value == null ? 'ok' : levelOf(key, value, idealRange(key, this.species(), this.view()?.tank)),
      };
    });
  });

  protected readonly checks = computed(() => {
    const out: { key: ParamKey; level: string; text: string }[] = [];
    for (const [key, raw] of Object.entries(this.raw()) as [ParamKey, string][]) {
      const value = parseNumber(raw);
      const range = idealRange(key, this.species(), this.view()?.tank);
      if (value == null || !range) continue;
      const def = PARAM_BY_KEY[key];
      const level = levelOf(key, value, range);
      out.push({
        key,
        level,
        text: `${def.short} ${fmt(value)} · ${level === 'ok' ? 'dans la plage' : 'hors plage'} ${fmtRange(range.min, range.max)}`,
      });
    }
    return out;
  });

  protected readonly hasValue = computed(() => Object.values(this.raw()).some((v) => parseNumber(v ?? '') != null));

  constructor() {
    // Bac choisi : celui de l'URL, sinon le premier.
    effect(() => {
      if (this.tankId()) return;
      const fromUrl = this.bac();
      const tanks = this.store.tankViews();
      const id = tanks.find((v) => v.tank.id === fromUrl)?.tank.id ?? tanks[0]?.tank.id;
      if (id) this.tankId.set(id);
    });
  }

  private readonly loadEdit = effect(() => {
    const t = this.editing();
    if (!t || this.loadedEdit) return;
    this.loadedEdit = true;
    this.tankId.set(t.tankId);
    this.raw.set(Object.fromEntries(Object.entries(t.values).map(([k, v]) => [k, String(v).replace('.', ',')])));
    this.note.set(t.note ?? '');
    this.when.set(toLocalInput(t.date));
  });

  protected set(key: ParamKey, value: string): void {
    this.raw.update((r) => ({ ...r, [key]: value }));
  }

  protected async save(): Promise<void> {
    if (!this.hasValue() || !this.tankId()) return;
    const values: Partial<Record<ParamKey, number>> = {};
    for (const [k, v] of Object.entries(this.raw()) as [ParamKey, string][]) {
      const n = parseNumber(v);
      if (n != null) values[k] = n;
    }
    const date = this.when() ? new Date(this.when()).toISOString() : new Date().toISOString();
    const note = this.note().trim() || undefined;
    const prev = this.editing();
    if (prev) await this.store.updateWaterTest({ ...prev, tankId: this.tankId(), date, values, note });
    else await this.store.addWaterTest({ tankId: this.tankId(), date, values, note });
    this.location.back();
  }
}

/** Date ISO → valeur d'un champ datetime-local (heure locale). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
