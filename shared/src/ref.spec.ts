import { describe, expect, it } from 'vitest';
import {
  consumableInputSchema,
  equipmentInputSchema,
  faunaInfoSchema,
  floraInfoSchema,
  idParamSchema,
  rangeSchema,
  refListSchema,
  refSpeciesSchema,
  sinceQuerySchema,
  speciesInputSchema,
} from './ref.js';

const date = '2026-10-25T00:00:00.000Z';

describe('rangeSchema', () => {
  it('accepte min ≤ max et refuse l’inverse', () => {
    expect(rangeSchema.safeParse({ min: 6, max: 6 }).success).toBe(true);
    expect(rangeSchema.safeParse({ min: 7, max: 6 }).success).toBe(false);
  });
});

describe('idParamSchema', () => {
  it.each(['danio-margaritatus', 'a', 'x1-y2'])('accepte %s', (id) => {
    expect(idParamSchema.safeParse({ id }).success).toBe(true);
  });
  it.each(['', 'Majuscule', 'avec espace', '-debut', 'fin-', 'double--tiret', 'a'.repeat(101)])(
    'refuse « %s »',
    (id) => {
      expect(idParamSchema.safeParse({ id }).success).toBe(false);
    },
  );
});

describe('sinceQuerySchema', () => {
  it('accepte l’absence de date ou une date ISO, refuse le reste', () => {
    expect(sinceQuerySchema.safeParse({}).success).toBe(true);
    expect(sinceQuerySchema.safeParse({ since: date }).success).toBe(true);
    expect(sinceQuerySchema.safeParse({ since: 'hier' }).success).toBe(false);
  });
});

describe('fiches espèces', () => {
  const base = { kind: 'plant', scientificName: 'Rotala', commonNames: [] };

  it('valide les informations de faune et de flore', () => {
    expect(
      faunaInfoSchema.safeParse({
        adultSizeCm: 3,
        temperament: 'peaceful',
        zone: 'all',
        diet: 'omnivore',
      }).success,
    ).toBe(true);
    expect(
      faunaInfoSchema.safeParse({
        adultSizeCm: 0,
        temperament: 'peaceful',
        zone: 'all',
        diet: 'omnivore',
      }).success,
    ).toBe(false);
    expect(
      floraInfoSchema.safeParse({
        light: 'low',
        co2: 'none',
        growth: 'slow',
        placement: 'floating',
        propagation: [],
      }).success,
    ).toBe(true);
    expect(
      floraInfoSchema.safeParse({
        light: 'extreme',
        co2: 'none',
        growth: 'slow',
        placement: 'floating',
        propagation: [],
      }).success,
    ).toBe(false);
  });

  it('refuse un type d’espèce inconnu et ignore les champs en trop', () => {
    expect(speciesInputSchema.safeParse({ ...base, kind: 'dragon' }).success).toBe(false);
    const parsed = speciesInputSchema.parse({ ...base, status: 'draft', createdBy: 'x' });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('createdBy');
  });

  it('exige les dates de la fiche publiée', () => {
    const fiche = { ...base, id: 'rotala', updatedAt: date, deletedAt: null };
    expect(refSpeciesSchema.safeParse(fiche).success).toBe(true);
    expect(refSpeciesSchema.safeParse({ ...fiche, deletedAt: date }).success).toBe(true);
    expect(refSpeciesSchema.safeParse({ ...fiche, updatedAt: 'hier' }).success).toBe(false);
  });

  it('enveloppe une liste de fiches', () => {
    const list = refListSchema(refSpeciesSchema);
    expect(list.safeParse({ items: [] }).success).toBe(true);
    expect(list.safeParse({ items: [{}] }).success).toBe(false);
  });
});

describe('équipements et consommables', () => {
  it('donnent des spécifications vides par défaut', () => {
    expect(equipmentInputSchema.parse({ type: 'filtre', brand: 'M', model: 'X' }).specs).toEqual(
      {},
    );
  });
  it('refusent des spécifications imbriquées', () => {
    expect(
      equipmentInputSchema.safeParse({
        type: 'filtre',
        brand: 'M',
        model: 'X',
        specs: { a: { b: 1 } },
      }).success,
    ).toBe(false);
  });
  it('l’unité d’un consommable est facultative', () => {
    expect(
      consumableInputSchema.safeParse({ type: 'engrais', brand: 'M', name: 'N' }).success,
    ).toBe(true);
    expect(
      consumableInputSchema.safeParse({ type: 'engrais', brand: 'M', name: 'N', unit: '' }).success,
    ).toBe(false);
  });
});
