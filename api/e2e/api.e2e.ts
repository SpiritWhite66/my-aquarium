import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { apiErrorSchema, healthResponseSchema } from '@aquarium/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Teste le serveur compilé (`npm run build -w api`), lancé comme en production, par de vraies requêtes HTTP.
const ORIGIN = 'https://exemple.github.io';
const entry = fileURLToPath(new URL('../dist/server.js', import.meta.url));
let child: ChildProcess;
let base = '';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('port introuvable'));
      });
    });
  });
}

async function waitReady(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Le serveur n'écoute pas encore : on réessaie.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Le serveur ne répond pas après 10 s');
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${String(port)}`;
  child = spawn(process.execPath, [entry], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      CORS_ORIGIN: ORIGIN,
      LOG_LEVEL: 'silent',
      APP_VERSION: 'e2e',
      RATE_LIMIT_MAX: '50',
    },
    stdio: 'ignore',
  });
  await waitReady(`${base}/health`);
});

afterAll(() => {
  child.kill('SIGTERM');
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
