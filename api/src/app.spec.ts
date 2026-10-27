import { apiErrorSchema, healthResponseSchema } from '@aquarium/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const ORIGIN = 'https://exemple.github.io';
let app: FastifyInstance | undefined;

async function start(extra: NodeJS.ProcessEnv = {}): Promise<FastifyInstance> {
  app = await buildApp(
    loadConfig({ CORS_ORIGIN: ORIGIN, LOG_LEVEL: 'silent', APP_VERSION: '9.9.9', ...extra }),
  );
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('répond ok avec la version, sans base de données', async () => {
    const res = await (await start()).inject('/health');
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok', version: '9.9.9' });
  });

  it('pose les en-têtes de sécurité', async () => {
    const res = await (await start()).inject('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it("autorise l'origine de l'appli", async () => {
    const res = await (await start()).inject({ url: '/health', headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('ne répond pas aux autres origines', async () => {
    const res = await (
      await start()
    ).inject({
      url: '/health',
      headers: { origin: 'https://pirate.example' },
    });
    expect(res.headers['access-control-allow-origin']).not.toBe('https://pirate.example');
  });
});

describe('erreurs', () => {
  it('renvoie une 404 au format commun', async () => {
    const res = await (await start()).inject('/nexiste-pas');
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it('limite le débit (429 au format commun)', async () => {
    const instance = await start({ RATE_LIMIT_MAX: '2' });
    await instance.inject('/health');
    await instance.inject('/health');
    const res = await instance.inject('/health');
    expect(res.statusCode).toBe(429);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('rate_limited');
  });

  it("masque le détail d'une erreur interne", async () => {
    const instance = await start();
    instance.get('/boum', () => {
      throw new Error('secret : mot de passe de la base');
    });
    const res = await instance.inject('/boum');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('internal');
  });

  it('renvoie 400 pour une requête mal formée', async () => {
    const instance = await start();
    instance.post('/echo', () => 'ok');
    const res = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{pas du json',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('bad_request');
  });
});
