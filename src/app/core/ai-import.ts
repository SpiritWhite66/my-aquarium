// Import des JSON produits par une IA à partir d'une photo (voir ai/SKILL.md).
// La validation lit le même schéma que celui donné à l'IA : une seule source de vérité.

import schema from '../../../ai/my-aquarium-ai.schema.json';
import type { Diagnosis, FindingCategory, ParamKey, QuantityUnit, Species, SpeciesKind } from './models';

export type Confidence = 'high' | 'medium' | 'low';

interface AiInventoryItem {
  scientificName: string;
  commonName?: string;
  kind: SpeciesKind;
  quantity: number;
  quantityIsEstimate?: boolean;
  unit: QuantityUnit;
  confidence: Confidence;
  note?: string;
}

interface AiReading {
  value: number;
  confidence: Confidence;
  note?: string;
}

export interface AiFinding {
  category: FindingCategory;
  severity: 'info' | 'warn' | 'danger';
  title: string;
  detail?: string;
  scientificName?: string;
  likelyCause?: string;
  advice?: string[];
  confidence: Confidence;
}

interface Envelope<K extends string, D> {
  format: 'my-aquarium-ai';
  version: 1;
  kind: K;
  capturedAt?: string;
  source?: { photo?: string; model?: string };
  warnings?: string[];
  data: D;
}

export type AiPayload =
  | Envelope<'inventory', { items: AiInventoryItem[] }>
  | Envelope<'water_test', { method: 'drops' | 'strips' | 'probe'; testKit?: string; values: Partial<Record<ParamKey, AiReading>> }>
  | Envelope<'sanity', { overall: 'good' | 'watch' | 'problem'; summary?: string; findings: AiFinding[] }>
  | Envelope<'diagnosis', Pick<Diagnosis, 'question' | 'summary' | 'hypotheses' | 'actions' | 'followUp'>>;

export type ParseResult = { ok: true; payloads: AiPayload[] } | { ok: false; errors: string[] };

// ---------- Validation (sous-ensemble de JSON Schema utilisé par notre schéma) ----------

type Schema = Record<string, unknown>;
const ROOT = schema as unknown as Schema;
const DEFS = ROOT['$defs'] as Record<string, Schema>;
const DATA_DEF: Record<string, string> = { inventory: 'InventoryData', water_test: 'WaterTestData', sanity: 'SanityData', diagnosis: 'DiagnosisData' };

function typeOk(type: string, v: unknown): boolean {
  switch (type) {
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'integer':
      return Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    default:
      return typeof v === type;
  }
}

function validate(s: Schema, v: unknown, path: string, errors: string[]): void {
  if (s['$ref']) {
    const name = (s['$ref'] as string).replace('#/$defs/', '');
    validate(DEFS[name], v, path, errors); return;
  }
  if ('const' in s && v !== s['const']) {
    errors.push(`${path} doit valoir ${JSON.stringify(s['const'])}`);
    return;
  }
  if (s['enum'] && !(s['enum'] as unknown[]).includes(v)) {
    errors.push(`${path} : « ${String(v)} » n’est pas accepté (${(s['enum'] as unknown[]).join(', ')})`);
    return;
  }
  if (s['type'] && !typeOk(s['type'] as string, v)) {
    errors.push(`${path} doit être de type ${s['type'] as string}`);
    return;
  }
  if (typeof v === 'number' && typeof s['minimum'] === 'number' && v < s['minimum']) {
    errors.push(`${path} doit être ≥ ${s['minimum']}`);
  }
  if (Array.isArray(v) && s['items']) {
    v.forEach((item, i) => { validate(s['items'] as Schema, item, `${path}[${i}]`, errors); });
  }
  if (typeOk('object', v) && (s['properties'] || s['required'])) {
    const obj = v as Record<string, unknown>;
    const props = (s['properties'] ?? {}) as Record<string, Schema>;
    for (const key of (s['required'] ?? []) as string[]) {
      if (!(key in obj)) errors.push(`${path}.${key} manquant`);
    }
    for (const [key, val] of Object.entries(obj)) {
      if (Object.hasOwn(props, key)) validate(props[key], val, `${path}.${key}`, errors);
      else if (s['additionalProperties'] === false) errors.push(`${path}.${key} n’est pas prévu par le format`);
    }
  }
}

export function validatePayload(value: unknown): string[] {
  const errors: string[] = [];
  validate(ROOT, value, 'json', errors);
  if (errors.length) return errors;
  const v = value as { kind: string; data: unknown };
  validate(DEFS[DATA_DEF[v.kind]], v.data, 'json.data', errors);
  return errors;
}

/**
 * Accepte le texte brut copié depuis l'IA : un ou plusieurs blocs ```json, ou du JSON nu
 * (objet seul ou tableau d'objets).
 */
export function parseAiText(text: string): ParseResult {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  const sources = blocks.length ? blocks : [text.trim()];
  const payloads: AiPayload[] = [];
  const errors: string[] = [];
  sources.forEach((src, i) => {
    const label = sources.length > 1 ? `Bloc ${i + 1} : ` : '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(src));
    } catch {
      errors.push(`${label}ce n’est pas du JSON valide.`);
      return;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const errs = validatePayload(item);
      if (errs.length) errors.push(...errs.slice(0, 8).map((e) => label + e));
      else payloads.push(item as AiPayload);
    }
  });
  if (!payloads.length && !errors.length) errors.push('Rien à importer.');
  return errors.length ? { ok: false, errors } : { ok: true, payloads };
}

/** Retire un éventuel texte autour du JSON (« Voici le résultat : {...} »). */
function extractJson(src: string): string {
  const start = src.search(/[[{]/);
  const end = Math.max(src.lastIndexOf('}'), src.lastIndexOf(']'));
  return start >= 0 && end > start ? src.slice(start, end + 1) : src;
}

// ---------- Rattachement au catalogue ----------

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[«»"'’()]/g, ' ')
    .replace(/\b(var|sp|spp|cf|aff)\b\.?/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Trouve l'espèce du catalogue correspondant à un nom donné par l'IA. */
export function matchSpecies(scientificName: string, commonName: string | undefined, species: Species[]): Species | undefined {
  const sci = norm(scientificName);
  const exact = species.find((s) => norm(s.scientificName) === sci);
  if (exact) return exact;
  // Même binôme (genre + espèce), en ignorant variété ou cultivar.
  const binomial = sci.split(' ').slice(0, 2).join(' ');
  if (binomial.includes(' ')) {
    const byBinomial = species.find((s) => norm(s.scientificName).split(' ').slice(0, 2).join(' ') === binomial);
    if (byBinomial) return byBinomial;
  }
  if (commonName) {
    const c = norm(commonName);
    const byCommon = species.find((s) => s.commonNames.some((n) => norm(n) === c));
    if (byCommon) return byCommon;
  }
  // « Genre sp. » : une seule espèce de ce genre dans le catalogue.
  const genus = sci.split(' ')[0];
  if (sci.split(' ').length === 1 && genus) {
    const sameGenus = species.filter((s) => norm(s.scientificName).split(' ')[0] === genus);
    if (sameGenus.length === 1) return sameGenus[0];
  }
  return undefined;
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: 'Sûr', medium: 'Probable', low: 'À vérifier' };

export const FINDING_CATEGORIES: Record<FindingCategory, string> = {
  algae: 'Algues',
  fish_health: 'Santé des poissons',
  invertebrate_health: 'Santé des invertébrés',
  plant_health: 'Santé des plantes',
  water_clarity: 'Aspect de l’eau',
  equipment: 'Matériel',
  aquascape: 'Décor',
  other: 'Autre',
};

export const OVERALL_LABELS = { good: 'Bon état', watch: 'À surveiller', problem: 'Problème' } as const;
