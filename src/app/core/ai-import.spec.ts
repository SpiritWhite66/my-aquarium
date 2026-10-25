import { describe, expect, it } from 'vitest';
import { BUILTIN_SPECIES } from './catalog';
import { matchSpecies, parseAiText, validatePayload } from './ai-import';

const inventory = {
  format: 'my-aquarium-ai',
  version: 1,
  kind: 'inventory',
  data: {
    items: [
      { scientificName: 'Danio margaritatus', kind: 'fish', quantity: 10, unit: 'individual', confidence: 'high' },
      { scientificName: 'Rotala rotundifolia', kind: 'plant', quantity: 12, unit: 'stem', confidence: 'medium' },
    ],
  },
};

describe('validation du JSON IA', () => {
  it('accepte un inventaire conforme', () => {
    expect(validatePayload(inventory)).toEqual([]);
  });

  it('refuse un champ inconnu, une valeur hors liste et un champ manquant', () => {
    const bad = structuredClone(inventory) as any;
    bad.data.items[0].tank = 'Bac salon';
    bad.data.items[1].unit = 'touffes';
    delete bad.data.items[1].confidence;
    const errors = validatePayload(bad);
    expect(errors.some((e) => e.includes('tank'))).toBe(true);
    expect(errors.some((e) => e.includes('touffes'))).toBe(true);
    expect(errors.some((e) => e.includes('confidence manquant'))).toBe(true);
  });

  it('refuse une mauvaise version', () => {
    expect(validatePayload({ ...inventory, version: 2 })[0]).toContain('version');
  });

  it('valide un relevé en gouttes et un bilan visuel', () => {
    expect(
      validatePayload({
        format: 'my-aquarium-ai', version: 1, kind: 'water_test',
        data: { method: 'drops', values: { ph: { value: 7.2, confidence: 'high' }, no3: { value: 25, confidence: 'low', note: 'entre 10 et 25' } } },
      }),
    ).toEqual([]);
    expect(
      validatePayload({
        format: 'my-aquarium-ai', version: 1, kind: 'sanity',
        data: { overall: 'watch', findings: [{ category: 'algae', severity: 'warn', title: 'Algues filamenteuses', confidence: 'medium', advice: ['Retirer à la main'] }] },
      }),
    ).toEqual([]);
  });
});

describe('lecture du texte collé', () => {
  it('extrait plusieurs blocs ```json entourés de texte', () => {
    const sanity = { format: 'my-aquarium-ai', version: 1, kind: 'sanity', data: { overall: 'good', findings: [] } };
    const text = `Voici l'inventaire :\n\`\`\`json\n${JSON.stringify(inventory)}\n\`\`\`\nEt le bilan :\n\`\`\`json\n${JSON.stringify(sanity)}\n\`\`\``;
    const r = parseAiText(text);
    expect(r.ok && r.payloads.map((p) => p.kind)).toEqual(['inventory', 'sanity']);
  });

  it('accepte du JSON nu précédé d’une phrase', () => {
    const r = parseAiText(`Résultat : ${JSON.stringify(inventory)}`);
    expect(r.ok).toBe(true);
  });

  it('signale un texte qui n’est pas du JSON', () => {
    const r = parseAiText('Je ne vois pas bien la photo.');
    expect(r.ok).toBe(false);
  });
});

describe('rattachement au catalogue', () => {
  const find = (sci: string, common?: string) => matchSpecies(sci, common, BUILTIN_SPECIES)?.id;

  it('reconnaît les noms exacts, les variantes et les noms communs', () => {
    expect(find('Neocaridina davidi')).toBe('neocaridina-davidi');
    expect(find('Neocaridina davidi var. red')).toBe('neocaridina-davidi');
    expect(find('Anubias barteri var. nana')).toBe('anubias-barteri-nana');
    expect(find('Echinodorus grisebachii "Bleheri"')).toBe('echinodorus-bleheri');
    expect(find('Bucephalandra sp.')).toBe('bucephalandra-sp');
    expect(find('Neritina sp.', 'Nérite zèbre')).toBe('neritina-natalensis');
    expect(find('Apistogramma borellii')).toBe('apistogramma-borellii');
  });

  it('ne force pas une espèce inconnue', () => {
    expect(find('Pterophyllum scalare')).toBeUndefined();
  });
});
