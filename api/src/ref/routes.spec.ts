import {
  apiErrorSchema,
  refListSchema,
  refSpeciesSchema,
  type SpeciesInput,
} from '@aquarium/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearRef, openTestDb, testDatabaseUrl } from '../../test/db.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';

const TOKEN = 'jeton-de-test-0123456789-0123456789';
const auth = { authorization: `Bearer ${TOKEN}` };
const ORIGIN = 'https://exemple.github.io';

const rasbora: SpeciesInput = {
  kind: 'fish',
  scientificName: 'Danio margaritatus',
  commonNames: ['Rasbora galaxy'],
  difficulty: 'easy',
  temp: { min: 20, max: 26 },
  ph: { min: 6.5, max: 7.5 },
  fauna: {
    adultSizeCm: 2.5,
    minGroup: 10,
    temperament: 'peaceful',
    zone: 'middle',
    diet: 'omnivore',
  },
  notes: 'Craintif.',
};

describe.skipIf(testDatabaseUrl === undefined)('référentiel (PostgreSQL réel)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;

  async function start(adminToken: string | null = TOKEN): Promise<FastifyInstance> {
    return buildApp(
      loadConfig({
        CORS_ORIGIN: ORIGIN,
        LOG_LEVEL: 'silent',
        RATE_LIMIT_MAX: '1000',
        ...(adminToken === null ? {} : { ADMIN_TOKEN: adminToken }),
      }),
      { db },
    );
  }

  const put = (id: string, payload: unknown, headers: Record<string, string> = auth) =>
    app.inject({ method: 'PUT', url: `/ref/species/${id}`, headers, payload: payload as object });

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await clearRef(db);
    app = await start();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('lecture', () => {
    it('renvoie une liste vide', async () => {
      const res = await app.inject('/ref/species');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [] });
    });

    it('renvoie les fiches publiées, mises en cache et validées par ETag', async () => {
      await put('danio-margaritatus', rasbora);
      const res = await app.inject('/ref/species');
      const body = refListSchema(refSpeciesSchema).parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        id: 'danio-margaritatus',
        ...rasbora,
        deletedAt: null,
      });
      expect(res.headers['cache-control']).toBe('public, max-age=300, must-revalidate');
      const etag = res.headers.etag;
      expect(etag).toBeTypeOf('string');
      const again = await app.inject({
        url: '/ref/species',
        headers: { 'if-none-match': String(etag) },
      });
      expect(again.statusCode).toBe(304);
    });

    it('ne renvoie que ce qui a changé depuis `since`', async () => {
      await put('a-premier', { ...rasbora, scientificName: 'Premier' });
      const first = refSpeciesSchema.parse(
        (await put('a-premier', { ...rasbora, scientificName: 'Premier' })).json(),
      );
      await put('b-second', { ...rasbora, scientificName: 'Second' });
      const res = await app.inject(`/ref/species?since=${encodeURIComponent(first.updatedAt)}`);
      const ids = refListSchema(refSpeciesSchema)
        .parse(res.json())
        .items.map((s) => s.id);
      expect(ids).toEqual(['b-second']);
    });

    it('trie par date de modification', async () => {
      await put('z-ancien', rasbora);
      await put('a-recent', rasbora);
      const items = refListSchema(refSpeciesSchema).parse(
        (await app.inject('/ref/species')).json(),
      ).items;
      expect(items.map((s) => s.id)).toEqual(['z-ancien', 'a-recent']);
    });

    it('refuse un `since` qui n’est pas une date', async () => {
      const res = await app.inject('/ref/species?since=hier');
      expect(res.statusCode).toBe(400);
      expect(apiErrorSchema.parse(res.json()).error).toEqual({
        code: 'invalid_request',
        message: 'Requête invalide : since.',
      });
    });

    it('renvoie une fiche par identifiant, 404 si absente, 400 si identifiant invalide', async () => {
      await put('danio-margaritatus', rasbora);
      expect((await app.inject('/ref/species/danio-margaritatus')).json()).toMatchObject({
        id: 'danio-margaritatus',
      });
      const missing = await app.inject('/ref/species/inconnue');
      expect(missing.statusCode).toBe(404);
      expect(apiErrorSchema.parse(missing.json()).error.code).toBe('not_found');
      expect((await app.inject('/ref/species/Pas%20Valide')).statusCode).toBe(400);
    });
  });

  describe('écriture réservée à l’administrateur', () => {
    it('refuse sans jeton (401) et avec un mauvais jeton (401)', async () => {
      const none = await put('x', rasbora, {});
      expect(none.statusCode).toBe(401);
      expect(apiErrorSchema.parse(none.json()).error.code).toBe('unauthorized');
      expect((await put('x', rasbora, { authorization: 'Bearer faux' })).statusCode).toBe(401);
      expect((await put('x', rasbora, { authorization: TOKEN })).statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: '/ref/species/x' })).statusCode).toBe(401);
    });

    it('refuse tout (403) quand aucun jeton n’est configuré', async () => {
      await app.close();
      app = await start(null);
      const res = await put('x', rasbora, auth);
      expect(res.statusCode).toBe(403);
      expect(apiErrorSchema.parse(res.json()).error.code).toBe('forbidden');
    });

    it('crée puis met à jour une fiche', async () => {
      const created = refSpeciesSchema.parse((await put('danio-margaritatus', rasbora)).json());
      expect(created.id).toBe('danio-margaritatus');
      const updated = refSpeciesSchema.parse(
        (await put('danio-margaritatus', { ...rasbora, notes: 'Mis à jour.' })).json(),
      );
      expect(updated.notes).toBe('Mis à jour.');
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
      const list = refListSchema(refSpeciesSchema).parse((await app.inject('/ref/species')).json());
      expect(list.items).toHaveLength(1);
    });

    it('efface les champs retirés lors d’une mise à jour', async () => {
      await put('danio-margaritatus', rasbora);
      const { notes: _n, ph: _p, ...sansNotesNiPh } = rasbora;
      const res = refSpeciesSchema.parse((await put('danio-margaritatus', sansNotesNiPh)).json());
      expect(res).not.toHaveProperty('notes');
      expect(res).not.toHaveProperty('ph');
    });

    it('refuse un corps invalide en nommant les champs, sans écho des valeurs', async () => {
      const res = await put('x', {
        kind: 'dragon',
        scientificName: '',
        commonNames: ['ok'],
        temp: { min: 30, max: 10 },
      });
      expect(res.statusCode).toBe(400);
      const message = apiErrorSchema.parse(res.json()).error.message;
      expect(message).toBe('Requête invalide : kind, scientificName, temp.');
      expect(message).not.toContain('dragon');
    });

    it('refuse un identifiant invalide avant de lire le corps', async () => {
      expect((await put('Pas Valide', rasbora)).statusCode).toBe(400);
    });

    it('supprime logiquement : introuvable en direct, signalée dans les mises à jour', async () => {
      const created = refSpeciesSchema.parse((await put('danio-margaritatus', rasbora)).json());
      const del = await app.inject({
        method: 'DELETE',
        url: '/ref/species/danio-margaritatus',
        headers: auth,
      });
      expect(del.statusCode).toBe(204);
      expect((await app.inject('/ref/species/danio-margaritatus')).statusCode).toBe(404);
      expect(
        refListSchema(refSpeciesSchema).parse((await app.inject('/ref/species')).json()).items,
      ).toEqual([]);
      const since = await app.inject(`/ref/species?since=${encodeURIComponent(created.updatedAt)}`);
      const [gone] = refListSchema(refSpeciesSchema).parse(since.json()).items;
      expect(gone?.id).toBe('danio-margaritatus');
      expect(gone?.deletedAt).toBeTypeOf('string');
    });

    it('supprimer une fiche absente renvoie 404', async () => {
      const del = await app.inject({
        method: 'DELETE',
        url: '/ref/species/inconnue',
        headers: auth,
      });
      expect(del.statusCode).toBe(404);
    });

    it('republier une fiche supprimée la rétablit', async () => {
      await put('danio-margaritatus', rasbora);
      await app.inject({ method: 'DELETE', url: '/ref/species/danio-margaritatus', headers: auth });
      await put('danio-margaritatus', rasbora);
      expect((await app.inject('/ref/species/danio-margaritatus')).statusCode).toBe(200);
    });

    it('ne laisse pas le client choisir status, created_by ni updatedAt', async () => {
      const res = refSpeciesSchema.parse(
        (
          await put('x', {
            ...rasbora,
            status: 'draft',
            createdBy: 'pirate',
            updatedAt: '2000-01-01T00:00:00.000Z',
          })
        ).json(),
      );
      expect(res).not.toHaveProperty('createdBy');
      expect(new Date(res.updatedAt).getFullYear()).toBeGreaterThan(2000);
    });
  });

  describe('équipements et consommables', () => {
    it('gèrent les mêmes opérations', async () => {
      const equipment = {
        type: 'filtre',
        brand: 'Marque',
        model: 'M-1',
        specs: { debitLh: 300, silencieux: true },
      };
      const consumable = { type: 'engrais', brand: 'Marque', name: 'Fer', unit: 'ml' };
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/ref/equipment/marque-m-1',
            headers: auth,
            payload: equipment,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/ref/consumable/marque-fer',
            headers: auth,
            payload: consumable,
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject('/ref/equipment/marque-m-1')).json()).toMatchObject(equipment);
      expect((await app.inject('/ref/consumable/marque-fer')).json()).toMatchObject(consumable);
      expect((await app.inject('/ref/equipment')).json()).toMatchObject({
        items: [{ id: 'marque-m-1' }],
      });
      expect((await app.inject('/ref/consumable')).json()).toMatchObject({
        items: [{ id: 'marque-fer' }],
      });
      for (const path of ['equipment/marque-m-1', 'consumable/marque-fer']) {
        expect(
          (await app.inject({ method: 'DELETE', url: `/ref/${path}`, headers: auth })).statusCode,
        ).toBe(204);
        expect((await app.inject(`/ref/${path}`)).statusCode).toBe(404);
      }
    });

    it('un consommable sans unité n’a pas de champ `unit`', async () => {
      await app.inject({
        method: 'PUT',
        url: '/ref/consumable/sans-unite',
        headers: auth,
        payload: { type: 'test', brand: 'M', name: 'N' },
      });
      expect(
        await app.inject('/ref/consumable/sans-unite').then((r): unknown => r.json()),
      ).not.toHaveProperty('unit');
    });
  });
});

describe('sans base de données', () => {
  it('répond 503 aux routes du référentiel et reste en vie', async () => {
    const app = await buildApp(loadConfig({ CORS_ORIGIN: ORIGIN, LOG_LEVEL: 'silent' }));
    const res = await app.inject('/ref/species');
    expect(res.statusCode).toBe(503);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('database_unavailable');
    expect((await app.inject('/health')).statusCode).toBe(200);
    await app.close();
  });
});
