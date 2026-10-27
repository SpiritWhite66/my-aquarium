import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearRef, openTestDb, testDatabaseUrl } from '../../test/db.js';
import type { Db } from '../db/client.js';
import { importSpecies, speciesFileSchema } from './import.js';
import { getSpecies, listSpecies } from './repository.js';

function seedFile(): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fichier d'amorçage fixe du dépôt
  return JSON.parse(readFileSync(new URL('../../data/species.json', import.meta.url), 'utf8'));
}

const fiche = {
  id: 'danio-margaritatus',
  kind: 'fish' as const,
  scientificName: 'Danio margaritatus',
  commonNames: ['Rasbora galaxy'],
};

describe('speciesFileSchema', () => {
  it('accepte le fichier d’amorçage du dépôt', () => {
    const data = seedFile();
    expect(speciesFileSchema.parse(data).length).toBeGreaterThanOrEqual(30);
  });

  it('refuse deux fiches de même identifiant', () => {
    expect(speciesFileSchema.safeParse([fiche, fiche]).success).toBe(false);
  });

  it('refuse une fiche invalide', () => {
    expect(speciesFileSchema.safeParse([{ ...fiche, kind: 'dragon' }]).success).toBe(false);
  });
});

describe.skipIf(testDatabaseUrl === undefined)('importSpecies (PostgreSQL réel)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await clearRef(db);
  });

  it('crée, puis ne réécrit pas ce qui n’a pas changé', async () => {
    expect(await importSpecies(db, [fiche])).toEqual({ created: 1, updated: 0, unchanged: 0 });
    const before = await getSpecies(db, fiche.id);
    expect(await importSpecies(db, [fiche])).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect((await getSpecies(db, fiche.id))?.updatedAt).toBe(before?.updatedAt);
  });

  it('met à jour une fiche modifiée', async () => {
    await importSpecies(db, [fiche]);
    const report = await importSpecies(db, [{ ...fiche, notes: 'Nouvelle note.' }]);
    expect(report).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect((await getSpecies(db, fiche.id))?.notes).toBe('Nouvelle note.');
  });

  it('rétablit une fiche supprimée', async () => {
    await importSpecies(db, [fiche]);
    await db.execute(sql`update ref.species set deleted_at = now()`);
    expect(await listSpecies(db, undefined)).toEqual([]);
    expect(await importSpecies(db, [fiche])).toEqual({ created: 1, updated: 0, unchanged: 0 });
  });

  it('importe tout le fichier d’amorçage', async () => {
    const data = seedFile();
    const report = await importSpecies(db, data);
    expect(report.created).toBe((data as unknown[]).length);
    expect(await listSpecies(db, undefined)).toHaveLength(report.created);
  });
});
