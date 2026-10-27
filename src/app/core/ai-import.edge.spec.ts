import { describe, expect, it } from 'vitest';
import { CONFIDENCE_LABELS, FINDING_CATEGORIES, OVERALL_LABELS, matchSpecies, parseAiText, validatePayload } from './ai-import';
import type { Species } from './models';

const env = (kind: string, data: unknown) => ({ format: 'my-aquarium-ai', version: 1, kind, data });
const item = (o = {}) => ({ scientificName: 'Danio margaritatus', kind: 'fish', quantity: 5, unit: 'individual', confidence: 'high', ...o });
const inventory = (...items: object[]) => env('inventory', { items });

describe('validatePayload', () => {
  it('accepte chaque type de données valide', () => {
    expect(validatePayload(inventory(item()))).toEqual([]);
    expect(validatePayload(env('water_test', { method: 'strips', values: { ph: { value: 7, confidence: 'high' } } }))).toEqual([]);
    expect(validatePayload(env('sanity', { overall: 'good', findings: [] }))).toEqual([]);
    expect(validatePayload(env('diagnosis', { summary: 's', hypotheses: [{ title: 'h', probability: 'low' }], actions: [{ title: 'a', priority: 'soon', task: { type: 'custom', label: 'l', everyDays: 7, inDays: 0 } }] }))).toEqual([]);
  });

  it.each([null, 'texte', 3, [], true])('refuse %j', (v) => {
    expect(validatePayload(v)[0]).toContain('doit être de type object');
  });

  it('refuse un mauvais format, avec la valeur attendue', () => {
    expect(validatePayload({ ...inventory(item()), format: 'autre' })).toEqual(['json.format doit valoir "my-aquarium-ai"']);
    expect(validatePayload({ ...inventory(item()), version: 2 })).toEqual(['json.version doit valoir 1']);
  });

  it('refuse un type de données inconnu en listant ceux acceptés', () => {
    const [e] = validatePayload({ ...inventory(item()), kind: 'autre' });
    expect(e).toMatch(/^json\.kind : « autre » n’est pas accepté \(.*inventory.*\)$/);
  });

  it('cite le chemin de chaque erreur, éléments de liste compris', () => {
    const errors = validatePayload(inventory(item(), item({ quantity: 0, unit: 'tas' }), item({ extra: 1 })));
    expect(errors).toContain('json.data.items[1].quantity doit être ≥ 1');
    expect(errors.some((e) => e.startsWith('json.data.items[1].unit : « tas » n’est pas accepté ('))).toBe(true);
    expect(errors).toContain('json.data.items[2].extra n’est pas prévu par le format');
  });

  it('vérifie les types des valeurs', () => {
    expect(validatePayload(inventory(item({ quantity: 1.5 })))).toContain('json.data.items[0].quantity doit être de type integer');
    expect(validatePayload(inventory(item({ quantity: '5' })))).toContain('json.data.items[0].quantity doit être de type integer');
    expect(validatePayload(inventory(item({ scientificName: 3 })))).toContain('json.data.items[0].scientificName doit être de type string');
    expect(validatePayload(inventory(item({ quantityIsEstimate: 'oui' })))).toContain('json.data.items[0].quantityIsEstimate doit être de type boolean');
    expect(validatePayload(env('inventory', { items: 'x' }))).toContain('json.data.items doit être de type array');
    expect(validatePayload(env('inventory', { items: [] }))).toEqual([]);
    expect(validatePayload(env('inventory', { items: ['x'] }))).toContain('json.data.items[0] doit être de type object');
    expect(validatePayload(env('inventory', { items: [[]] }))).toContain('json.data.items[0] doit être de type object');
    expect(validatePayload(env('inventory', 'x'))).toContain('json.data doit être de type object');
  });

  it('vérifie les nombres, finis et sous leur minimum', () => {
    const water = (value: unknown) => env('water_test', { method: 'drops', values: { ph: { value, confidence: 'high' } } });
    expect(validatePayload(water('7'))).toContain('json.data.values.ph.value doit être de type number');
    expect(validatePayload(water(Infinity))).toContain('json.data.values.ph.value doit être de type number');
    expect(validatePayload(water(NaN))).toContain('json.data.values.ph.value doit être de type number');
    expect(validatePayload(water(7.2))).toEqual([]);
    const diagnosis = (everyDays: number) => env('diagnosis', { summary: 's', hypotheses: [], actions: [{ title: 'a', priority: 'now', task: { type: 'custom', label: 'l', everyDays } }] });
    expect(validatePayload(diagnosis(0))).toContain('json.data.actions[0].task.everyDays doit être ≥ 1');
    expect(validatePayload(diagnosis(1))).toEqual([]);
  });

  it('signale champs manquants et paramètres inconnus', () => {
    expect(validatePayload(env('sanity', { findings: [] }))).toContain('json.data.overall manquant');
    expect(validatePayload({ format: 'my-aquarium-ai', version: 1, kind: 'sanity' })).toContain('json.data manquant');
    expect(validatePayload(env('water_test', { method: 'drops', values: { zzz: { value: 1, confidence: 'high' } } }))).toContain('json.data.values.zzz n’est pas prévu par le format');
  });

  it('ne valide les données que si l’enveloppe est correcte', () => {
    const errors = validatePayload({ ...inventory(item({ quantity: 0 })), version: 9 });
    expect(errors).toEqual(['json.version doit valoir 1']);
  });
});

describe('parseAiText', () => {
  const block = (o: unknown, tag = 'json') => '```' + tag + '\n' + JSON.stringify(o) + '\n```';

  it('lit un bloc de code, avec ou sans étiquette json', () => {
    for (const text of [block(inventory(item())), block(inventory(item()), ''), `Voici :\n${block(inventory(item()))}\nBonne journée`]) {
      const r = parseAiText(text);
      expect(r.ok && r.payloads.map((p) => p.kind)).toEqual(['inventory']);
    }
  });

  it('lit du JSON nu, entouré de texte, ou un tableau', () => {
    expect(parseAiText(JSON.stringify(inventory(item()))).ok).toBe(true);
    expect(parseAiText(`Résultat : ${JSON.stringify(inventory(item()))} — fin.`).ok).toBe(true);
    const r = parseAiText(JSON.stringify([inventory(item()), env('sanity', { overall: 'good', findings: [] })]));
    expect(r.ok && r.payloads.map((p) => p.kind)).toEqual(['inventory', 'sanity']);
    expect(parseAiText(`Liste : ${JSON.stringify([inventory(item())])}`).ok).toBe(true);
  });

  it('lit plusieurs blocs dans l’ordre', () => {
    const r = parseAiText(`${block(inventory(item()))}\n\n${block(env('sanity', { overall: 'good', findings: [] }))}`);
    expect(r.ok && r.payloads.map((p) => p.kind)).toEqual(['inventory', 'sanity']);
  });

  it('refuse un texte qui n’est pas du JSON', () => {
    expect(parseAiText('Je ne vois rien')).toEqual({ ok: false, errors: ['ce n’est pas du JSON valide.'] });
    expect(parseAiText('')).toEqual({ ok: false, errors: ['ce n’est pas du JSON valide.'] });
    expect(parseAiText('{ pas du json }')).toEqual({ ok: false, errors: ['ce n’est pas du JSON valide.'] });
  });

  it('numérote les blocs fautifs quand il y en a plusieurs', () => {
    const r = parseAiText(`${block(inventory(item()))}\n\`\`\`json\n{ cassé\n\`\`\``);
    expect(r).toEqual({ ok: false, errors: ['Bloc 2 : ce n’est pas du JSON valide.'] });
    const r2 = parseAiText(`${block(inventory(item({ quantity: 0 })))}\n${block(inventory(item()))}`);
    expect(r2).toMatchObject({ ok: false, errors: ['Bloc 1 : json.data.items[0].quantity doit être ≥ 1'] });
  });

  it('sans bloc, les erreurs n’ont pas de préfixe', () => {
    const r = parseAiText(JSON.stringify(inventory(item({ quantity: 0 }))));
    expect(r).toEqual({ ok: false, errors: ['json.data.items[0].quantity doit être ≥ 1'] });
  });

  it('limite à huit erreurs par élément', () => {
    const bad = inventory(...Array.from({ length: 12 }, () => item({ quantity: 0 })));
    const r = parseAiText(JSON.stringify(bad));
    expect(!r.ok && r.errors).toHaveLength(8);
  });

  it('un tableau vide ne contient rien à importer', () => {
    expect(parseAiText('[]')).toEqual({ ok: false, errors: ['Rien à importer.'] });
  });

  it('une seule erreur suffit à tout refuser', () => {
    const r = parseAiText(JSON.stringify([inventory(item()), inventory(item({ quantity: 0 }))]));
    expect(r.ok).toBe(false);
  });
});

describe('matchSpecies', () => {
  const sp = (id: string, scientificName: string, commonNames: string[] = []): Species => ({ id, scientificName, commonNames, kind: 'fish', source: 'builtin' }) as Species;
  const list = [
    sp('dm', 'Danio margaritatus', ['Célestial pearl']),
    sp('ab', 'Anubias barteri', ['Anubias']),
    sp('nl', 'Paracheirodon innesi', ['Néon bleu']),
    sp('nr', 'Paracheirodon axelrodi', ['Néon rouge']),
    sp('ap', 'Apistogramma borellii', []),
  ];
  const id = (sci: string, common?: string) => matchSpecies(sci, common, list)?.id;

  it('reconnaît le nom exact, sans tenir compte des majuscules ni des accents', () => {
    expect(id('Danio margaritatus')).toBe('dm');
    expect(id('DANIO   MARGARITATUS')).toBe('dm');
    expect(id('Dániö margaritatus')).toBe('dm');
  });

  it('ignore variété, cultivar, abréviations et ponctuation', () => {
    expect(id('Anubias barteri var. nana')).toBe('ab');
    expect(id('Anubias barteri "Nana"')).toBe('ab');
    expect(id('Anubias barteri cf. nana')).toBe('ab');
    expect(id('Danio (margaritatus)')).toBe('dm');
    expect(id('Anubias   barteri  aff.  nana')).toBe('ab');
  });

  it('retrouve une espèce par son nom commun quand le nom scientifique ne correspond pas', () => {
    expect(id('Paracheirodon sp. blue', 'néon bleu')).toBe('nl');
    expect(id('Truc machin', 'Néon rouge')).toBe('nr');
    expect(id('Truc machin', 'Inconnu')).toBeUndefined();
    expect(id('Truc machin')).toBeUndefined();
  });

  it('« Genre sp. » trouve l’espèce si elle est seule de son genre', () => {
    expect(id('Danio sp.')).toBe('dm');
    expect(id('Danio')).toBe('dm');
    expect(id('Apistogramma spp.')).toBe('ap');
    expect(id('Paracheirodon sp.')).toBeUndefined();
    expect(id('Corydoras sp.')).toBeUndefined();
    expect(id('')).toBeUndefined();
  });

  it('un binôme inconnu d’un genre connu ne correspond à rien', () => {
    expect(id('Danio rerio')).toBeUndefined();
  });

  it('préfère le nom scientifique exact au nom commun', () => {
    expect(id('Danio margaritatus', 'Néon bleu')).toBe('dm');
  });
});

describe('libellés', () => {
  it('décrit les niveaux de confiance, les catégories et l’état général', () => {
    expect(CONFIDENCE_LABELS).toEqual({ high: 'Sûr', medium: 'Probable', low: 'À vérifier' });
    expect(OVERALL_LABELS).toEqual({ good: 'Bon état', watch: 'À surveiller', problem: 'Problème' });
    expect(Object.keys(FINDING_CATEGORIES)).toEqual(['algae', 'fish_health', 'invertebrate_health', 'plant_health', 'water_clarity', 'equipment', 'aquascape', 'other']);
    expect(FINDING_CATEGORIES.algae).toBe('Algues');
  });
});
