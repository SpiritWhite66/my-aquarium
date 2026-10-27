import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { SpeciesStore } from '../../core/stores/species.store';
import { PopulationStore } from '../../core/stores/population.store';
import type { FaunaInfo, FloraInfo, Range, Species, SpeciesKind } from '../../core/models';
import { DIETS, DIFFICULTIES, GROWTHS, KINDS, LIGHTS, PLACEMENTS, TEMPERAMENTS, ZONES, parseNumber } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { LivestockRepo } from '../../core/data/livestock.repo';

type RangeKey = 'temp' | 'ph' | 'gh' | 'kh';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'temp', label: 'Température (°C)' },
  { key: 'ph', label: 'pH' },
  { key: 'gh', label: 'GH (°d)' },
  { key: 'kh', label: 'KH (°d)' },
];

const entries = <T extends string>(r: Record<T, string>) => Object.entries(r) as [T, string][];
const str = (n?: number) => (n == null ? '' : String(n).replace('.', ','));

/**
 * Création ou modification d'une fiche personnelle.
 * Une fiche du catalogue intégré se « personnalise » : on en crée une copie modifiable,
 * et les habitants qui l'utilisaient basculent sur la copie.
 */
@Component({
  selector: 'app-species-form',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: flex; flex-direction: column; gap: 18px; }
    .rg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .info { padding: 12px 14px; background: var(--wab); color: var(--wa); border-color: var(--wa); font-size: 14px; }
  `,
  template: `
    <div class="page" style="max-width: 680px">
      <header class="top" style="justify-content: flex-start">
        <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
        <h1 class="h1 grow">{{ title() }}</h1>
      </header>
      @if (source()?.source === 'builtin') {
        <p class="card info">Fiche du catalogue intégré : tes modifications seront enregistrées dans une fiche personnelle, utilisée à la place de celle-ci dans tes bacs.</p>
      }
      <form (submit)="$event.preventDefault(); save()">
        <div class="form-grid">
          <div class="field full">
            <label for="kind">Type</label>
            <select id="kind" (change)="kind.set($any($event.target).value)">
              @for (k of kinds; track k[0]) { <option [value]="k[0]" [selected]="k[0] === kind()">{{ k[1] }}</option> }
            </select>
          </div>
          <div class="field full">
            <label for="sci">Nom scientifique</label>
            <input id="sci" required [value]="sci()" (input)="sci.set(v($event))" placeholder="Genre espèce" />
          </div>
          <div class="field full">
            <label for="names">Noms communs (séparés par des virgules)</label>
            <input id="names" [value]="names()" (input)="names.set(v($event))" />
          </div>
          <div class="field full">
            <label for="diff">Difficulté</label>
            <select id="diff" (change)="difficulty.set($any($event.target).value)">
              <option value="" [selected]="!difficulty()">Non précisée</option>
              @for (d of difficulties; track d[0]) { <option [value]="d[0]" [selected]="d[0] === difficulty()">{{ d[1] }}</option> }
            </select>
          </div>
        </div>

        <section class="stack">
          <h2 class="h2">Paramètres de l’eau</h2>
          <p class="sub" style="margin: 0">Laisser vide si inconnu : la plage ne sera pas prise en compte.</p>
          @for (r of ranges; track r.key) {
            <div class="rg">
              <div class="field"><label [for]="r.key + '-min'">{{ r.label }} min</label>
                <input [id]="r.key + '-min'" class="num" inputmode="decimal" [value]="range()[r.key][0]" (input)="setRange(r.key, 0, v($event))" /></div>
              <div class="field"><label [for]="r.key + '-max'">max</label>
                <input [id]="r.key + '-max'" class="num" inputmode="decimal" [value]="range()[r.key][1]" (input)="setRange(r.key, 1, v($event))" /></div>
            </div>
          }
        </section>

        @if (kind() === 'plant') {
          <section class="stack">
            <h2 class="h2">Plante</h2>
            <div class="form-grid">
              <div class="field"><label for="light">Lumière</label>
                <select id="light" (change)="flora.update(f => ({ ...f, light: $any($event.target).value }))">
                  @for (o of lights; track o[0]) { <option [value]="o[0]" [selected]="o[0] === flora().light">{{ o[1] }}</option> }
                </select></div>
              <div class="field"><label for="co2">CO2</label>
                <select id="co2" (change)="flora.update(f => ({ ...f, co2: $any($event.target).value }))">
                  <option value="none" [selected]="flora().co2 === 'none'">Inutile</option>
                  <option value="beneficial" [selected]="flora().co2 === 'beneficial'">Conseillé</option>
                  <option value="required" [selected]="flora().co2 === 'required'">Requis</option>
                </select></div>
              <div class="field"><label for="growth">Croissance</label>
                <select id="growth" (change)="flora.update(f => ({ ...f, growth: $any($event.target).value }))">
                  @for (o of growths; track o[0]) { <option [value]="o[0]" [selected]="o[0] === flora().growth">{{ o[1] }}</option> }
                </select></div>
              <div class="field"><label for="place">Placement</label>
                <select id="place" (change)="flora.update(f => ({ ...f, placement: $any($event.target).value }))">
                  @for (o of placements; track o[0]) { <option [value]="o[0]" [selected]="o[0] === flora().placement">{{ o[1] }}</option> }
                </select></div>
              <div class="field"><label for="form">Forme</label>
                <input id="form" [value]="flora().form ?? ''" placeholder="tige, rosette, mousse…" (input)="flora.update(f => ({ ...f, form: v($event) || undefined }))" /></div>
              <div class="field"><label for="hmax">Hauteur max (cm)</label>
                <input id="hmax" class="num" inputmode="numeric" [value]="str(flora().maxHeightCm)" (input)="flora.update(f => ({ ...f, maxHeightCm: num(v($event)) }))" /></div>
              <div class="field full"><label for="prop">Multiplication (séparée par des virgules)</label>
                <input id="prop" [value]="flora().propagation.join(', ')" (change)="flora.update(f => ({ ...f, propagation: list(v($event)) }))" /></div>
            </div>
          </section>
        } @else {
          <section class="stack">
            <h2 class="h2">Animal</h2>
            <div class="form-grid">
              <div class="field"><label for="size">Taille adulte (cm)</label>
                <input id="size" class="num" inputmode="decimal" [value]="str(fauna().adultSizeCm)" (input)="fauna.update(f => ({ ...f, adultSizeCm: num(v($event)) ?? 0 }))" /></div>
              <div class="field"><label for="group">Groupe minimal</label>
                <input id="group" class="num" inputmode="numeric" [value]="str(fauna().minGroup)" (input)="fauna.update(f => ({ ...f, minGroup: num(v($event)) }))" /></div>
              <div class="field"><label for="vol">Volume minimal (L)</label>
                <input id="vol" class="num" inputmode="numeric" [value]="str(fauna().minTankLiters)" (input)="fauna.update(f => ({ ...f, minTankLiters: num(v($event)) }))" /></div>
              <div class="field"><label for="temper">Comportement</label>
                <select id="temper" (change)="fauna.update(f => ({ ...f, temperament: $any($event.target).value }))">
                  @for (o of temperaments; track o[0]) { <option [value]="o[0]" [selected]="o[0] === fauna().temperament">{{ o[1] }}</option> }
                </select></div>
              <div class="field"><label for="zone">Zone</label>
                <select id="zone" (change)="fauna.update(f => ({ ...f, zone: $any($event.target).value }))">
                  @for (o of zones; track o[0]) { <option [value]="o[0]" [selected]="o[0] === fauna().zone">{{ o[1] }}</option> }
                </select></div>
              <div class="field"><label for="diet">Régime</label>
                <select id="diet" (change)="fauna.update(f => ({ ...f, diet: $any($event.target).value }))">
                  @for (o of diets; track o[0]) { <option [value]="o[0]" [selected]="o[0] === fauna().diet">{{ o[1] }}</option> }
                </select></div>
              <div class="field full"><label for="role">Rôle</label>
                <input id="role" [value]="fauna().role ?? ''" placeholder="Nettoyeuse, mange les algues…" (input)="fauna.update(f => ({ ...f, role: v($event) || undefined }))" /></div>
            </div>
            <label class="check"><input type="checkbox" [checked]="!!fauna().eatsPlants" (change)="fauna.update(f => ({ ...f, eatsPlants: $any($event.target).checked }))" />Mange les plantes</label>
            <label class="check"><input type="checkbox" [checked]="has('shrimp_fry')" (change)="togglePredation('shrimp_fry', $any($event.target).checked)" />Mange les jeunes crevettes</label>
            <label class="check"><input type="checkbox" [checked]="has('shrimp')" (change)="togglePredation('shrimp', $any($event.target).checked)" />Chasse les crevettes adultes</label>
            <label class="check"><input type="checkbox" [checked]="has('snails')" (change)="togglePredation('snails', $any($event.target).checked)" />Mange les escargots</label>
          </section>
        }

        <div class="field">
          <label for="notes">Notes</label>
          <textarea id="notes" [value]="notes()" (input)="notes.set(v($event))"></textarea>
        </div>

        @if (error()) { <p style="color: var(--dg)" role="alert">{{ error() }}</p> }
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn fill" type="submit" [disabled]="!sci().trim()">Enregistrer</button>
          @if (source()?.source === 'custom') {
            <button class="btn danger" type="button" (click)="remove()"><app-icon name="trash" [size]="18" />Supprimer</button>
          }
        </div>
      </form>
    </div>
  `,
})
export class SpeciesFormPage {
  private readonly store = inject(AquariumStore);
  private readonly speciesStore = inject(SpeciesStore);
  private readonly populationStore = inject(PopulationStore);
  protected readonly livestockRepo = inject(LivestockRepo);
  private readonly router = inject(Router);
  protected readonly location = inject(Location);

  /** Fiche à modifier (absent : nouvelle fiche). */
  readonly id = input<string>();

  protected readonly kinds = entries(KINDS);
  protected readonly difficulties = entries(DIFFICULTIES);
  protected readonly lights = entries(LIGHTS);
  protected readonly growths = entries(GROWTHS);
  protected readonly placements = entries(PLACEMENTS);
  protected readonly temperaments = entries(TEMPERAMENTS);
  protected readonly zones = entries(ZONES);
  protected readonly diets = entries(DIETS);
  protected readonly ranges = RANGES;
  protected readonly str = str;

  protected readonly kind = signal<SpeciesKind>('fish');
  protected readonly sci = signal('');
  protected readonly names = signal('');
  protected readonly difficulty = signal<Species['difficulty'] | ''>('');
  protected readonly notes = signal('');
  protected readonly range = signal<Record<RangeKey, [string, string]>>({ temp: ['', ''], ph: ['', ''], gh: ['', ''], kh: ['', ''] });
  protected readonly flora = signal<FloraInfo>({ light: 'medium', co2: 'none', growth: 'medium', placement: 'midground', propagation: [] });
  protected readonly fauna = signal<FaunaInfo>({ adultSizeCm: 0, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' });
  protected readonly error = signal('');

  protected readonly source = computed(() => (this.id() ? this.speciesStore.speciesById().get(this.id()!) : undefined));
  protected readonly title = computed(() => (!this.id() ? 'Nouvelle espèce' : this.source()?.source === 'builtin' ? 'Personnaliser la fiche' : 'Modifier la fiche'));

  private loaded = false;

  constructor() {
    effect(() => {
      const s = this.source();
      if (!s || this.loaded) return;
      this.loaded = true;
      this.kind.set(s.kind);
      this.sci.set(s.scientificName);
      this.names.set(s.commonNames.join(', '));
      this.difficulty.set(s.difficulty ?? '');
      this.notes.set(s.notes ?? '');
      const r = (x?: Range): [string, string] => [str(x?.min), str(x?.max)];
      this.range.set({ temp: r(s.temp), ph: r(s.ph), gh: r(s.gh), kh: r(s.kh) });
      if (s.flora) this.flora.set({ ...s.flora });
      if (s.fauna) this.fauna.set({ ...s.fauna });
    });
  }

  protected v(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  protected num(raw: string): number | undefined {
    return parseNumber(raw);
  }
  protected list(raw: string): string[] {
    return raw.split(',').map((x) => x.trim()).filter(Boolean);
  }
  protected has(p: NonNullable<FaunaInfo['predation']>[number]): boolean {
    return !!this.fauna().predation?.includes(p);
  }
  protected togglePredation(p: NonNullable<FaunaInfo['predation']>[number], on: boolean): void {
    this.fauna.update((f) => {
      const set = new Set(f.predation ?? []);
      if (on) set.add(p);
      else set.delete(p);
      return { ...f, predation: set.size ? [...set] : undefined };
    });
  }
  protected setRange(key: RangeKey, i: 0 | 1, value: string): void {
    this.range.update((r) => {
      const next: [string, string] = [...r[key]];
      next[i] = value;
      return { ...r, [key]: next };
    });
  }

  private toRange(key: RangeKey): Range | undefined {
    const [a, b] = this.range()[key].map(parseNumber);
    if (a == null || b == null) return undefined;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  protected async save(): Promise<void> {
    const sci = this.sci().trim();
    if (!sci) return;
    const commonNames = this.list(this.names());
    const prev = this.source();
    const data = {
      kind: this.kind(),
      scientificName: sci,
      commonNames: commonNames.length ? commonNames : [sci],
      source: 'custom' as const,
      difficulty: this.difficulty() || undefined,
      temp: this.toRange('temp'),
      ph: this.toRange('ph'),
      gh: this.toRange('gh'),
      kh: this.toRange('kh'),
      flora: this.kind() === 'plant' ? this.flora() : undefined,
      fauna: this.kind() !== 'plant' ? this.fauna() : undefined,
      notes: this.notes().trim() || undefined,
      gbifKey: prev?.gbifKey,
      wikidataId: prev?.wikidataId,
      imageUrl: prev?.imageUrl,
      overrides: prev?.source === 'builtin' ? prev.id : prev?.overrides,
    };
    let id: string;
    if (prev?.source === 'builtin') {
      id = await this.livestockRepo.saveSpecies(data);
      await this.livestockRepo.replaceSpecies(prev.id, id);
    } else {
      id = await this.livestockRepo.saveSpecies({ ...data, id: prev?.id });
    }
    this.router.navigate(['/catalogue', id], { replaceUrl: true });
  }

  protected async remove(): Promise<void> {
    const s = this.source();
    if (!s) return;
    const used = this.populationStore.inhabitants().filter((i) => i.speciesId === s.id).length;
    if (used) {
      this.error.set(`Cette fiche est utilisée par ${used} habitant${used > 1 ? 's' : ''} : retire-les d’abord de tes bacs.`);
      return;
    }
    if (!confirm('Supprimer cette fiche personnelle ?')) return;
    await this.livestockRepo.deleteSpecies(s.id);
    this.router.navigate(['/catalogue'], { replaceUrl: true });
  }
}
