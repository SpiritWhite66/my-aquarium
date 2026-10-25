import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AquariumStore } from '../../core/store';
import type { ParamKey, QuantityUnit, Species, SpeciesKind } from '../../core/models';
import {
  CONFIDENCE_LABELS,
  FINDING_CATEGORIES,
  OVERALL_LABELS,
  matchSpecies,
  parseAiText,
  type AiFinding,
  type AiPayload,
  type Confidence,
} from '../../core/ai-import';
import { PARAM_BY_KEY, idealRange, isAlive, levelOf } from '../../core/rules';
import { KINDS, UNITS, fmt, fmtRange, parseNumber, unitLabel } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { speciesIcon } from '../../shared/visuals';

interface InventoryRow {
  include: boolean;
  scientificName: string;
  commonName?: string;
  kind: SpeciesKind;
  species?: Species; // trouvée dans le catalogue
  quantity: string;
  estimate: boolean;
  unit: QuantityUnit;
  confidence: Confidence;
  note?: string;
  existingQty?: number; // déjà présente dans le bac
  replace: boolean; // remplacer la quantité existante plutôt qu'ajouter
}

interface ReadingRow {
  include: boolean;
  key: ParamKey;
  value: string;
  confidence: Confidence;
  note?: string;
}

interface DiagnosisPreview {
  data: Extract<AiPayload, { kind: 'diagnosis' }>['data'];
  warnings?: string[];
  createTasks: boolean[];
}

interface Preview {
  inventory: InventoryRow[];
  readings: ReadingRow[];
  readingMethod?: 'drops' | 'strips' | 'probe';
  readingDate?: string;
  sanity?: { overall: 'good' | 'watch' | 'problem'; summary?: string; findings: AiFinding[]; date?: string; photo?: string; warnings?: string[] };
  warnings: string[];
  diagnosis?: DiagnosisPreview;
}

@Component({
  selector: 'app-ai-import',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-import.scss',
  templateUrl: './ai-import.html',
})
export class AiImportPage {
  protected readonly store = inject(AquariumStore);
  private readonly router = inject(Router);

  /** `?bac=` et `?text=` (partage depuis une autre app via le Web Share Target). */
  readonly bac = input<string>();
  readonly text = input<string>();

  protected readonly kinds = KINDS;
  protected readonly unitList = Object.entries(UNITS) as [QuantityUnit, [string, string]][];
  protected readonly conf = CONFIDENCE_LABELS;
  protected readonly categories = FINDING_CATEGORIES;
  protected readonly overallLabels = OVERALL_LABELS;
  protected readonly params = PARAM_BY_KEY;
  protected readonly icon = speciesIcon;
  protected readonly unitLabel = unitLabel;
  protected readonly fmt = fmt;
  protected readonly probLabels = { high: 'Très probable', medium: 'Possible', low: 'Peu probable' } as const;
  protected readonly prioLabels = { now: 'Maintenant', soon: 'Bientôt', later: 'Plus tard' } as const;

  protected readonly tankId = signal('');
  protected readonly raw = signal('');
  protected readonly errors = signal<string[]>([]);
  protected readonly preview = signal<Preview | null>(null);
  protected readonly copied = signal(false);
  protected readonly saving = signal(false);

  private readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.tankId()));

  protected readonly readingChecks = computed(() => {
    const v = this.view();
    const species = v?.members.map((m) => m.species) ?? [];
    const out: Record<string, { level: string; range: string }> = {};
    for (const r of this.preview()?.readings ?? []) {
      const n = parseNumber(r.value);
      const range = idealRange(r.key, species, v?.tank);
      out[r.key] = {
        level: n == null || !range ? 'ok' : levelOf(r.key, n, range),
        range: range ? fmtRange(range.min, range.max, PARAM_BY_KEY[r.key].unit) : '',
      };
    }
    return out;
  });

  protected readonly count = computed(() => {
    const p = this.preview();
    if (!p) return 0;
    return p.inventory.filter((r) => r.include).length + (p.readings.some((r) => r.include) ? 1 : 0) + (p.sanity ? 1 : 0) + (p.diagnosis ? 1 : 0);
  });

  constructor() {
    effect(() => {
      if (this.tankId()) return;
      const tanks = this.store.tankViews();
      const id = tanks.find((v) => v.tank.id === this.bac())?.tank.id ?? tanks[0]?.tank.id;
      if (id) this.tankId.set(id);
    });
    // Texte reçu par partage : analyse directe une fois le catalogue chargé.
    effect(() => {
      const shared = this.text();
      if (shared && !this.raw() && this.store.ready() && this.store.species().length) {
        this.raw.set(shared);
        this.analyze();
      }
    });
  }

  protected async copyPrompt(): Promise<void> {
    const prompt = await fetch('ai/prompt.md').then((r) => r.text());
    await navigator.clipboard.writeText(prompt);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2500);
  }

  protected async pasteFromClipboard(): Promise<void> {
    try {
      this.raw.set(await navigator.clipboard.readText());
      this.analyze();
    } catch {
      this.errors.set(['Le presse-papiers n’est pas accessible : colle le texte dans le champ.']);
    }
  }

  protected async loadFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.raw.set(await file.text());
    this.analyze();
  }

  protected analyze(): void {
    const result = parseAiText(this.raw());
    if (!result.ok) {
      this.errors.set(result.errors);
      this.preview.set(null);
      return;
    }
    this.errors.set([]);
    this.rebuild(result.payloads);
  }

  /** Construit l'aperçu ; relancé si on change de bac (quantités déjà présentes). */
  private rebuild(payloads: AiPayload[]): void {
    this.lastPayloads = payloads;
    const species = this.store.catalog();
    const inTank = this.store.inhabitants().filter((i) => i.tankId === this.tankId() && isAlive(i));
    const preview: Preview = { inventory: [], readings: [], warnings: [] };

    for (const p of payloads) {
      preview.warnings.push(...(p.warnings ?? []));
      if (p.kind === 'inventory') {
        for (const item of p.data.items) {
          const sp = matchSpecies(item.scientificName, item.commonName, species);
          const existing = sp && inTank.find((i) => i.speciesId === sp.id);
          preview.inventory.push({
            include: true,
            scientificName: item.scientificName,
            commonName: item.commonName,
            kind: item.kind,
            species: sp,
            quantity: String(item.quantity),
            estimate: !!item.quantityIsEstimate,
            unit: existing?.unit ?? item.unit,
            confidence: item.confidence,
            note: item.note,
            existingQty: existing?.quantity,
            replace: !!existing,
          });
        }
      } else if (p.kind === 'water_test') {
        preview.readingMethod = p.data.method;
        preview.readingDate = p.capturedAt;
        for (const [key, r] of Object.entries(p.data.values) as [ParamKey, { value: number; confidence: Confidence; note?: string }][]) {
          preview.readings.push({ include: true, key, value: String(r.value).replace('.', ','), confidence: r.confidence, note: r.note });
        }
      } else if (p.kind === 'diagnosis') {
        preview.diagnosis = { data: p.data, warnings: p.warnings, createTasks: p.data.actions.map((a) => !!a.task) };
      } else {
        preview.sanity = { ...p.data, date: p.capturedAt, photo: p.source?.photo, warnings: p.warnings };
      }
    }
    this.preview.set(preview);
  }
  private lastPayloads: AiPayload[] = [];

  protected changeTank(id: string): void {
    this.tankId.set(id);
    if (this.preview()) this.rebuild(this.lastPayloads);
  }

  protected updateRow(i: number, changes: Partial<InventoryRow>): void {
    this.preview.update((p) => p && { ...p, inventory: p.inventory.map((r, j) => (j === i ? { ...r, ...changes } : r)) });
  }

  protected updateReading(i: number, changes: Partial<ReadingRow>): void {
    this.preview.update((p) => p && { ...p, readings: p.readings.map((r, j) => (j === i ? { ...r, ...changes } : r)) });
  }

  protected toggleTask(i: number, on: boolean): void {
    this.preview.update((p) => p?.diagnosis ? { ...p, diagnosis: { ...p.diagnosis, createTasks: p.diagnosis.createTasks.map((v, j) => (j === i ? on : v)) } } : p);
  }

  protected reset(): void {
    this.preview.set(null);
    this.raw.set('');
  }

  protected async save(): Promise<void> {
    const p = this.preview();
    const tankId = this.tankId();
    if (!p || !tankId || this.saving()) return;
    this.saving.set(true);
    try {
      let target = 'population';

      for (const row of p.inventory.filter((r) => r.include)) {
        const quantity = Math.round(parseNumber(row.quantity) ?? 0);
        if (quantity < 1) continue;
        const speciesId =
          row.species?.id ??
          (await this.store.saveSpecies({
            kind: row.kind,
            scientificName: row.scientificName,
            commonNames: [row.commonName || row.scientificName],
            source: 'custom',
            notes: 'Fiche créée depuis un inventaire IA, à compléter.',
          }));
        const existing = this.store.inhabitants().find((i) => i.tankId === tankId && i.speciesId === speciesId && isAlive(i));
        if (existing && row.replace) {
          await this.store.updateInhabitant(existing.id, { quantity, approximate: row.estimate });
          await this.store.recordEvent(existing, 'note', 0, `Inventaire IA : ${existing.quantity} → ${quantity}`);
        } else {
          await this.store.addInhabitant({
            tankId,
            speciesId,
            quantity,
            approximate: row.estimate,
            unit: row.unit,
            addedDate: this.store.today(),
            status: 'healthy',
            origin: 'Inventaire IA',
          });
        }
      }

      const values: Partial<Record<ParamKey, number>> = {};
      for (const r of p.readings.filter((r) => r.include)) {
        const n = parseNumber(r.value);
        if (n != null) values[r.key] = n;
      }
      if (Object.keys(values).length) {
        const uncertain = p.readings.filter((r) => r.include && r.confidence === 'low').map((r) => PARAM_BY_KEY[r.key].short);
        await this.store.addWaterTest({
          tankId,
          date: p.readingDate ?? new Date().toISOString(),
          values,
          method: p.readingMethod,
          note: ['Lu par une IA sur photo', uncertain.length ? `à vérifier : ${uncertain.join(', ')}` : ''].filter(Boolean).join(' · '),
        });
        target = 'eau';
      }

      if (p.sanity) {
        const species = this.store.catalog();
        await this.store.addObservation({
          tankId,
          date: p.sanity.date ?? new Date().toISOString(),
          overall: p.sanity.overall,
          summary: p.sanity.summary,
          source: p.sanity.photo,
          warnings: p.sanity.warnings,
          findings: p.sanity.findings.map((f) => ({
            ...f,
            speciesId: f.scientificName ? matchSpecies(f.scientificName, undefined, species)?.id : undefined,
          })),
        });
        target = 'population';
      }

      if (p.diagnosis) {
        const d = p.diagnosis;
        await this.store.addDiagnosis({ tankId, date: new Date().toISOString(), ...d.data, warnings: d.warnings }, d.createTasks);
        target = 'population';
      }

      this.router.navigate(['/bacs', tankId, target]);
    } finally {
      this.saving.set(false);
    }
  }
}
