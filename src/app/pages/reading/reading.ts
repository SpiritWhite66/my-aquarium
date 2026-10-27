import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { AquariumStore } from '../../core/store';
import { WaterStore } from '../../core/stores/water.store';
import { ALGAE_LEVELS, ALGAE_TYPES } from '../../core/labels';
import type {
  AlgaeLevel, ParamKey, WaterTest } from '../../core/models';
import { EXTRA_PARAMS, MAIN_PARAMS, PARAM_BY_KEY, idealRange, levelOf, measuredParams } from '../../core/rules';
import { fmt, fmtRange, fmtShortDate, parseNumber } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { defaultTank, fromEntity } from '../../shared/form-state';
import { CareRepo } from '../../core/data/care.repo';

/** Saisie rapide d'un relevé : valeurs précédentes en indication, contrôle immédiat de la plage. */
@Component({
  selector: 'app-reading',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .algae { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .lv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .lv button, .types button { height: 36px; border-radius: 8px; border: 1px solid var(--ln); background: var(--sf); font: 600 13px var(--font); cursor: pointer; color: var(--ink); }
    .types { display: flex; flex-wrap: wrap; gap: 6px; }
    .types button { padding: 0 10px; font-weight: 500; }
    .lv button.on, .types button.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
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

      @if (!editing()) {
        <section class="card algae" aria-labelledby="algae-title">
          <h2 class="h2" id="algae-title">Algues <span class="sub" style="margin: 0; font-weight: 500">facultatif</span></h2>
          <div class="lv" role="group" aria-label="Quantité d’algues">
            @for (l of algaeLevels; track $index; let i = $index) {
              <button type="button" [class.on]="algae() === i" [attr.aria-pressed]="algae() === i" (click)="algae.set(algae() === i ? null : $any(i))">{{ l }}</button>
            }
          </div>
          @if (algae()) {
            <div class="types" role="group" aria-label="Types d’algues">
              @for (t of algaeTypeList; track t) {
                <button type="button" [class.on]="algaeTypes().has(t)" [attr.aria-pressed]="algaeTypes().has(t)" (click)="toggleType(t)">{{ t }}</button>
              }
            </div>
          }
        </section>
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
  protected readonly waterStore = inject(WaterStore);
  protected readonly careRepo = inject(CareRepo);
  protected readonly location = inject(Location);

  /** `?bac=` dans l'URL. */
  readonly bac = input<string>();
  /** `?edit=` : identifiant du relevé à corriger. */
  readonly edit = input<string>();

  protected readonly nowLocal = toLocalInput(new Date().toISOString());
  protected readonly editing = computed(() => this.waterStore.waterTests().find((t) => t.id === this.edit()));
  // En correction, les champs prennent les valeurs du relevé enregistré, puis appartiennent à la saisie.
  protected readonly when = fromEntity(this.editing, (t) => toLocalInput(t.date), this.nowLocal);
  /** Bac du relevé corrigé ; sinon celui de l'URL, sinon le premier. */
  protected readonly tankId = defaultTank(() => this.store.tankViews().map((v) => v.tank.id), this.bac, () => this.editing()?.tankId);
  protected readonly raw = fromEntity<WaterTest, Partial<Record<ParamKey, string>>>(
    this.editing,
    (t) => Object.fromEntries(Object.entries(t.values).map(([k, v]) => [k, String(v).replace('.', ',')])),
    {},
  );
  protected readonly note = fromEntity(this.editing, (t) => t.note ?? '', '');
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

  private readonly hasWater = computed(() => Object.values(this.raw()).some((v) => parseNumber(v ?? '') != null));
  protected readonly hasValue = computed(() => this.hasWater() || this.algae() != null);

  protected readonly algaeLevels = ALGAE_LEVELS;
  protected readonly algaeTypeList = ALGAE_TYPES;
  protected readonly algae = signal<AlgaeLevel | null>(null);
  protected readonly algaeTypes = signal(new Set<string>());
  protected toggleType(t: string): void {
    this.algaeTypes.update((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

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
    if (prev) await this.careRepo.updateWaterTest({ ...prev, tankId: this.tankId(), date, values, note });
    else if (this.hasWater()) await this.careRepo.addWaterTest({ tankId: this.tankId(), date, values, note });
    const level = this.algae();
    if (level != null && !prev) {
      const types = [...this.algaeTypes()];
      await this.careRepo.addObservation({
        tankId: this.tankId(),
        date,
        manual: true,
        algaeLevel: level,
        algaeTypes: types.length ? types : undefined,
        overall: level === 0 ? 'good' : level === 3 ? 'problem' : 'watch',
        summary: `Algues : ${ALGAE_LEVELS[level].toLowerCase()}${types.length ? ' (' + types.join(', ') + ')' : ''}`,
        findings: [],
      });
    }
    this.location.back();
  }
}

/** Date ISO → valeur d'un champ datetime-local (heure locale). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
