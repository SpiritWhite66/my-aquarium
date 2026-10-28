import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AquariumDb } from './db';
import { useFakeIndexedDb } from './fake-db.testing';
import { markRemote } from './sync-outbox';
import type { Species, Tank } from './models';

let db: AquariumDb;
let n = 0;
const U = '2026-10-01T10:00:00.000Z';
const tank = (id: string, name = 'Bac'): Tank => ({
  id,
  updatedAt: U,
  name,
  type: 'planted',
  volumeGross: 60,
  startDate: '2026-01-01',
  co2: false,
  archived: false,
});
const species = (id: string, source: Species['source']): Species => ({
  id,
  updatedAt: U,
  kind: 'fish',
  scientificName: id,
  commonNames: [],
  source,
});
const keys = async () => (await db.outbox.toArray()).map((e) => e.key).sort();

beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb(`outbox-${String(n++)}`);
});
afterEach(async () => {
  await db.delete();
});

describe('file des modifications locales', () => {
  it('note les ajouts et modifications, une entrée par ligne', async () => {
    await db.tanks.put(tank('a'));
    await db.tanks.bulkPut([tank('a', 'Renommé'), tank('b')]);
    await db.tanks.update('a', { name: 'Encore' });
    expect(await keys()).toEqual(['tanks|a', 'tanks|b']);
    const entry = await db.outbox.get('tanks|a');
    expect(entry).toMatchObject({ table: 'tanks', id: 'a' });
    expect(Date.parse(entry?.at ?? '')).not.toBeNaN();
  });

  it('change de révision à chaque modification', async () => {
    await db.tanks.put(tank('a'));
    const first = (await db.outbox.get('tanks|a'))?.rev ?? 0;
    await db.tanks.put(tank('a', 'B'));
    expect((await db.outbox.get('tanks|a'))?.rev).toBeGreaterThan(first);
  });

  it('note les suppressions, une par une ou en masse', async () => {
    await db.tanks.bulkPut([tank('a'), tank('b'), tank('c')]);
    await db.outbox.clear();
    await db.tanks.delete('a');
    await db.tanks.where('id').equals('b').delete();
    await db.tanks.where('id').equals('c').modify({ name: 'Modifié en masse' });
    expect(await keys()).toEqual(['tanks|a', 'tanks|b', 'tanks|c']);
    await db.outbox.clear();
    await db.tanks.clear();
    expect(await keys()).toEqual(['tanks|c']);
  });

  it('suit les écritures faites dans une transaction de l’appli', async () => {
    await db.transaction('rw', db.tanks, db.tasks, async () => {
      await db.tanks.put(tank('a'));
    });
    expect(await keys()).toEqual(['tanks|a']);
  });

  it('ignore les tables non synchronisées (photos, préférences)', async () => {
    await db.photos.put({ id: 'p', updatedAt: U, tankId: 'a', date: U, width: 1, height: 1 });
    await db.refMeta.put({ id: 'species', since: U, syncedAt: U });
    expect(await keys()).toEqual([]);
  });

  it('ne note que les fiches d’espèces créées par l’utilisateur', async () => {
    await db.species.bulkPut([species('perso', 'custom'), species('integre', 'builtin')]);
    expect(await keys()).toEqual(['species|perso']);
    await db.outbox.clear();
    await db.species.bulkDelete(['perso', 'integre']);
    expect(await keys()).toEqual(['species|perso']);
    await db.outbox.clear();
    await db.species.bulkPut([species('perso2', 'custom'), species('integre2', 'builtin')]);
    await db.outbox.clear();
    await db.species.clear();
    expect(await keys()).toEqual(['species|perso2']);
  });

  it('ignore les écritures venues du serveur', async () => {
    await db.transaction('rw', db.tanks, async (tx) => {
      markRemote(tx);
      await db.tanks.put(tank('a'));
      await db.tanks.delete('a');
    });
    expect(await keys()).toEqual([]);
  });

  it('prévient à chaque modification locale, pas pour les autres', async () => {
    const spy = vi.fn();
    db.onLocalChange = spy;
    await db.tanks.put(tank('a'));
    expect(spy).toHaveBeenCalledTimes(1);
    await db.refMeta.put({ id: 'species', since: U, syncedAt: U });
    await db.transaction('rw', db.tanks, async (tx) => {
      markRemote(tx);
      await db.tanks.put(tank('b'));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('annule l’entrée si l’écriture échoue (même transaction)', async () => {
    await db.tanks.add(tank('a'));
    await db.outbox.clear();
    await expect(db.tanks.add(tank('a'))).rejects.toThrow();
    expect(await keys()).toEqual([]);
  });
});
