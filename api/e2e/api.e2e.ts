import { apiErrorSchema, healthResponseSchema } from '@aquarium/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningServer, startServer } from './server.js';

// Teste le serveur compilé, lancé comme en production, par de vraies requêtes HTTP.
const ORIGIN = 'https://exemple.github.io';
let server: RunningServer;
let base = '';

beforeAll(async () => {
  server = await startServer({ CORS_ORIGIN: ORIGIN, APP_VERSION: 'e2e', RATE_LIMIT_MAX: '50' });
  base = server.base;
});

afterAll(() => {
  server.stop();
});

describe('API compilée', () => {
  it('répond sur /health au format partagé', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: 'ok', version: 'e2e' });
  });

  it('annonce uniquement l’origine de l’appli en CORS', async () => {
    const ok = await fetch(`${base}/health`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const ko = await fetch(`${base}/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://pirate.example', 'access-control-request-method': 'GET' },
    });
    // Le serveur annonce toujours l'origine autorisée ; le navigateur refuse donc tout autre site.
    expect(ko.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('envoie les en-têtes de sécurité et ne révèle pas le framework', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('renvoie une 404 au format commun', async () => {
    const res = await fetch(`${base}/nexiste-pas`);
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('not_found');
  });

  it('limite le débit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) statuses.push((await fetch(`${base}/health`)).status);
    expect(statuses).toContain(429);
  });
});
