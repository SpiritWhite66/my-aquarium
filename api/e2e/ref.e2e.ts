import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refListSchema, refSpeciesSchema } from '@aquarium/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningServer, startServer } from './server.js';

// Référentiel de bout en bout : serveur compilé + PostgreSQL réel (TEST_DATABASE_URL), comme en production.
const databaseUrl = process.env['TEST_DATABASE_URL'];
const TOKEN = 'jeton-e2e-0123456789-0123456789-ab';
const ORIGIN = 'https://exemple.github.io';
const bearer = { authorization: `Bearer ${TOKEN}` };
const auth = { ...bearer, 'content-type': 'application/json' };
const migrate = fileURLToPath(new URL('../dist/db/migrate.js', import.meta.url));
const importer = fileURLToPath(new URL('../dist/db/import-ref.js', import.meta.url));

describe.skipIf(databaseUrl === undefined)('référentiel (serveur compilé + PostgreSQL)', () => {
  let server: RunningServer;
  let env: Record<string, string>;

  beforeAll(async () => {
    env = {
      PATH: process.env['PATH'] ?? '',
      CORS_ORIGIN: ORIGIN,
      DATABASE_URL: databaseUrl ?? '',
      ADMIN_TOKEN: TOKEN,
      RATE_LIMIT_MAX: '1000',
    };
    execFileSync(process.execPath, [migrate], { env, stdio: 'ignore' });
    server = await startServer(env);
  });
  afterAll(() => {
    server.stop();
  });

  it('une fiche ajoutée côté serveur apparaît dans la liste, puis disparaît quand elle est retirée', async () => {
    const id = `e2e-${String(Date.now())}`;
    const before = new Date().toISOString();
    const put = await fetch(`${server.base}/ref/species/${id}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({
        kind: 'snail',
        scientificName: 'Testus e2e',
        commonNames: ['Escargot test'],
      }),
    });
    expect(put.status).toBe(200);

    const list = await fetch(`${server.base}/ref/species?since=${encodeURIComponent(before)}`);
    const added = refListSchema(refSpeciesSchema).parse(await list.json()).items;
    expect(added.map((s) => s.id)).toContain(id);

    expect(
      (await fetch(`${server.base}/ref/species/${id}`, { method: 'DELETE', headers: bearer }))
        .status,
    ).toBe(204);
    const after = await fetch(`${server.base}/ref/species?since=${encodeURIComponent(before)}`);
    const removed = refListSchema(refSpeciesSchema)
      .parse(await after.json())
      .items.find((s) => s.id === id);
    expect(removed?.deletedAt).toBeTypeOf('string');
  });

  it('refuse l’écriture sans jeton, et sert le cache par ETag', async () => {
    const denied = await fetch(`${server.base}/ref/species/x`, { method: 'PUT', body: '{}' });
    expect(denied.status).toBe(401);
    const first = await fetch(`${server.base}/ref/species`);
    const etag = first.headers.get('etag');
    expect(etag).not.toBeNull();
    const second = await fetch(`${server.base}/ref/species`, {
      headers: { 'if-none-match': etag ?? '' },
    });
    expect(second.status).toBe(304);
  });

  it('l’import du catalogue de départ est idempotent', () => {
    const run = () => execFileSync(process.execPath, [importer], { env, encoding: 'utf8' });
    run();
    expect(run()).toMatch(/"created":0,"updated":0,"unchanged":\d+/);
  });
});
