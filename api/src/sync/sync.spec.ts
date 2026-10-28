import { syncPullResultSchema, type SyncChange } from '@aquarium/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAuth, openTestDb, testDatabaseUrl } from '../../test/db.js';
import { signedInUser, TEST_SECRET } from '../../test/session.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { PULL_PAGE } from './repository.js';

type AuthHeaders = Record<string, string>;

const tank = (id: string, name: string, updatedAt: string): SyncChange => ({
  table: 'tanks',
  id,
  updatedAt,
  deleted: false,
  data: { id, name, updatedAt, type: 'planted', volumeGross: 60, archived: false },
});

describe.skipIf(testDatabaseUrl === undefined)('synchronisation (PostgreSQL réel)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let alice: AuthHeaders;
  let bob: AuthHeaders;

  const pushChanges = (headers: AuthHeaders, changes: unknown[]) =>
    app.inject({ method: 'POST', url: '/sync/push', headers, payload: { changes } });
  const pullAll = async (headers: AuthHeaders, after = 0) => {
    const res = await app.inject({ url: `/sync/pull?after=${String(after)}`, headers });
    expect(res.statusCode).toBe(200);
    return syncPullResultSchema.parse(res.json());
  };

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await clearAuth(db);
    app = await buildApp(
      loadConfig({
        CORS_ORIGIN: 'https://exemple.github.io',
        LOG_LEVEL: 'silent',
        RATE_LIMIT_MAX: '10000',
        USER_RATE_LIMIT_MAX: '10000',
        JWT_SECRET: TEST_SECRET,
      }),
      { db },
    );
    alice = (await signedInUser(db, 'alice@exemple.fr')).headers;
    bob = (await signedInUser(db, 'bob@exemple.fr')).headers;
  });

  it('exige une connexion', async () => {
    expect((await pushChanges({ authorization: 'Bearer x' }, [])).statusCode).toBe(401);
    expect((await app.inject({ url: '/sync/pull' })).statusCode).toBe(401);
  });

  it('enregistre puis renvoie les modifications, avec un curseur', async () => {
    const res = await pushChanges(alice, [
      tank('t1', 'Salon', '2026-10-01T10:00:00.000Z'),
      tank('t2', 'Nano', '2026-10-01T11:00:00.000Z'),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ accepted: 2, ignored: 0 });

    const first = await pullAll(alice);
    expect(first.changes.map((c) => c.id)).toEqual(['t1', 't2']);
    expect(first.changes[0]?.data).toMatchObject({ name: 'Salon' });
    expect(first.more).toBe(false);
    expect((await pullAll(alice, first.cursor)).changes).toEqual([]);
  });

  it('la modification la plus récente gagne, quel que soit l’ordre d’arrivée', async () => {
    await pushChanges(alice, [tank('t1', 'Récent', '2026-10-02T10:00:00.000Z')]);
    const stale = await pushChanges(alice, [tank('t1', 'Ancien', '2026-10-01T10:00:00.000Z')]);
    expect(stale.json()).toEqual({ accepted: 0, ignored: 1 });
    const same = await pushChanges(alice, [tank('t1', 'Même date', '2026-10-02T10:00:00.000Z')]);
    expect(same.json()).toEqual({ accepted: 0, ignored: 1 });
    const { changes } = await pullAll(alice);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.data).toMatchObject({ name: 'Récent' });
  });

  it('renvoie une ligne modifiée après le curseur, une seule fois', async () => {
    await pushChanges(alice, [tank('t1', 'A', '2026-10-01T10:00:00.000Z')]);
    const { cursor } = await pullAll(alice);
    await pushChanges(alice, [tank('t1', 'B', '2026-10-01T11:00:00.000Z')]);
    const next = await pullAll(alice, cursor);
    expect(next.changes.map((c) => c.data?.['name'])).toEqual(['B']);
    expect(next.cursor).toBeGreaterThan(cursor);
  });

  it('propage les suppressions', async () => {
    await pushChanges(alice, [tank('t1', 'A', '2026-10-01T10:00:00.000Z')]);
    const { cursor } = await pullAll(alice);
    const del = await pushChanges(alice, [
      {
        table: 'tanks',
        id: 't1',
        updatedAt: '2026-10-01T12:00:00.000Z',
        deleted: true,
        data: null,
      },
    ]);
    expect(del.json()).toEqual({ accepted: 1, ignored: 0 });
    const { changes } = await pullAll(alice, cursor);
    expect(changes).toEqual([
      {
        table: 'tanks',
        id: 't1',
        updatedAt: '2026-10-01T12:00:00.000Z',
        deleted: true,
        data: null,
      },
    ]);
  });

  it('ramène une date dans le futur à l’heure du serveur (horloge en avance)', async () => {
    await pushChanges(alice, [tank('t1', 'Futur', '2099-01-01T00:00:00.000Z')]);
    const { changes } = await pullAll(alice);
    expect(new Date(changes[0]?.updatedAt ?? '').getTime()).toBeLessThanOrEqual(Date.now());
    // Une modification faite ensuite par un appareil à l'heure gagne bien.
    const later = new Date(Date.now() + 1000).toISOString();
    expect((await pushChanges(alice, [tank('t1', 'Juste', later)])).json()).toEqual({
      accepted: 1,
      ignored: 0,
    });
  });

  it('pagine les longues listes', async () => {
    const many = Array.from({ length: PULL_PAGE + 20 }, (_, i) =>
      tank(`t${String(i).padStart(4, '0')}`, `Bac ${String(i)}`, '2026-10-01T10:00:00.000Z'),
    );
    for (let i = 0; i < many.length; i += 100) await pushChanges(alice, many.slice(i, i + 100));
    const first = await pullAll(alice);
    expect(first.changes).toHaveLength(PULL_PAGE);
    expect(first.more).toBe(true);
    const second = await pullAll(alice, first.cursor);
    expect(second.changes).toHaveLength(20);
    expect(second.more).toBe(false);
  });

  it('isolation : un compte ne lit ni n’écrase jamais les données d’un autre', async () => {
    await pushChanges(alice, [tank('t1', 'Bac d’Alice', '2026-10-01T10:00:00.000Z')]);
    expect((await pullAll(bob)).changes).toEqual([]);
    // Même identifiant, date plus récente : crée une ligne chez Bob, ne touche pas Alice.
    await pushChanges(bob, [tank('t1', 'Bac de Bob', '2026-10-05T10:00:00.000Z')]);
    expect((await pullAll(alice)).changes[0]?.data).toMatchObject({ name: 'Bac d’Alice' });
    expect((await pullAll(bob)).changes[0]?.data).toMatchObject({ name: 'Bac de Bob' });
  });

  it('les données disparaissent avec le compte', async () => {
    await pushChanges(alice, [tank('t1', 'A', '2026-10-01T10:00:00.000Z')]);
    await app.inject({ method: 'DELETE', url: '/me', headers: alice });
    const [row] = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from aqua.records`,
    );
    expect(row?.n).toBe('0');
  });

  it.each([
    ['une table inconnue', { ...tank('t1', 'A', '2026-10-01T10:00:00.000Z'), table: 'users' }],
    [
      'un id différent dans les données',
      { ...tank('t1', 'A', '2026-10-01T10:00:00.000Z'), id: 't2' },
    ],
    ['une date invalide', { ...tank('t1', 'A', '2026-10-01T10:00:00.000Z'), updatedAt: 'hier' }],
    [
      'une suppression avec des données',
      { ...tank('t1', 'A', '2026-10-01T10:00:00.000Z'), deleted: true },
    ],
    [
      'une ligne sans données',
      {
        table: 'tanks',
        id: 't1',
        updatedAt: '2026-10-01T10:00:00.000Z',
        deleted: false,
        data: null,
      },
    ],
    [
      'une ligne trop volumineuse',
      {
        ...tank('t1', 'A', '2026-10-01T10:00:00.000Z'),
        data: { id: 't1', notes: 'x'.repeat(70 * 1024) },
      },
    ],
  ])('refuse %s', async (_nom, change) => {
    const res = await pushChanges(alice, [change]);
    expect(res.statusCode).toBe(400);
    expect((await pullAll(alice)).changes).toEqual([]);
  });

  it('refuse un envoi vide ou trop long', async () => {
    expect((await pushChanges(alice, [])).statusCode).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) =>
      tank(`t${String(i)}`, 'A', '2026-10-01T10:00:00.000Z'),
    );
    expect((await pushChanges(alice, tooMany)).statusCode).toBe(400);
  });

  it('refuse un curseur invalide', async () => {
    const res = await app.inject({ url: '/sync/pull?after=-1', headers: alice });
    expect(res.statusCode).toBe(400);
  });

  it('applique le quota de lignes par compte', async () => {
    await db.execute(sql`
      insert into aqua.records (user_id, tbl, id, data, updated_at)
      select u.id, 'tanks', 'q' || g, '{}'::jsonb, now()
      from auth.users u, generate_series(1, 50000) g where u.email = 'alice@exemple.fr'`);
    const res = await pushChanges(alice, [tank('t-de-trop', 'A', '2026-10-01T10:00:00.000Z')]);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'quota_exceeded' } });
    expect((await pushChanges(bob, [tank('t1', 'A', '2026-10-01T10:00:00.000Z')])).statusCode).toBe(
      200,
    );
  });
});
