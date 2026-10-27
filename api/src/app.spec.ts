import { apiErrorSchema, healthResponseSchema } from '@aquarium/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, loggerOptions } from './app.js';
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

describe('messages et statuts', () => {
  it('donne un message lisible pour chaque erreur', async () => {
    const instance = await start({ RATE_LIMIT_MAX: '1' });
    instance.get('/boum', () => {
      throw new Error('x');
    });
    instance.post('/echo', () => 'ok');
    const notFound = await instance.inject('/nexiste-pas');
    expect(apiErrorSchema.parse(notFound.json()).error.message).toBe('Ressource introuvable.');
    await instance.inject('/health');
    const limited = await instance.inject('/health');
    expect(limited.statusCode).toBe(429);
    expect(apiErrorSchema.parse(limited.json()).error.message).toBe(
      'Trop de requêtes, réessaie un peu plus tard.',
    );
  });

  it('message de la 400 et de la 500', async () => {
    const instance = await start();
    instance.get('/boum', () => {
      throw new Error('x');
    });
    instance.post('/echo', () => 'ok');
    const internal = await instance.inject('/boum');
    expect(apiErrorSchema.parse(internal.json()).error.message).toBe('Erreur interne du serveur.');
    const bad = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(apiErrorSchema.parse(bad.json()).error.message).toBe('Requête invalide.');
  });

  it('garde le statut 4xx de l’erreur (415 : type de contenu non géré)', async () => {
    const instance = await start();
    instance.post('/echo', () => 'ok');
    const res = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-inconnu' },
      payload: 'a',
    });
    expect(res.statusCode).toBe(415);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('bad_request');
  });

  it('une erreur sans statut devient une 500', async () => {
    const instance = await start();
    instance.get('/boum', () => {
      throw new Error('sans statut');
    });
    expect((await instance.inject('/boum')).statusCode).toBe(500);
  });

  it('une erreur en dessous de 400 devient une 500', async () => {
    const instance = await start();
    instance.get('/bizarre', () => {
      throw Object.assign(new Error('x'), { statusCode: 302 });
    });
    expect((await instance.inject('/bizarre')).statusCode).toBe(500);
  });
});

describe('CORS : méthodes', () => {
  it('autorise seulement GET, POST, PUT et DELETE', async () => {
    const res = await (
      await start()
    ).inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE');
  });
});

describe('limite de débit derrière le proxy Render', () => {
  const headers = (ip: string) => ({ 'x-forwarded-for': ip });

  it('en production, compte chaque visiteur (X-Forwarded-For) séparément', async () => {
    const instance = await start({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@h/db',
      RATE_LIMIT_MAX: '1',
    });
    expect(
      (await instance.inject({ url: '/health', headers: headers('1.1.1.1') })).statusCode,
    ).toBe(200);
    expect(
      (await instance.inject({ url: '/health', headers: headers('2.2.2.2') })).statusCode,
    ).toBe(200);
    expect(
      (await instance.inject({ url: '/health', headers: headers('1.1.1.1') })).statusCode,
    ).toBe(429);
  });

  it('hors production, ignore X-Forwarded-For (non fiable)', async () => {
    const instance = await start({ RATE_LIMIT_MAX: '1' });
    expect(
      (await instance.inject({ url: '/health', headers: headers('1.1.1.1') })).statusCode,
    ).toBe(200);
    expect(
      (await instance.inject({ url: '/health', headers: headers('2.2.2.2') })).statusCode,
    ).toBe(429);
  });
});

describe('loggerOptions', () => {
  it('masque les secrets et reprend le niveau demandé', () => {
    expect(loggerOptions({ LOG_LEVEL: 'warn' })).toEqual({
      level: 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    });
  });
});
