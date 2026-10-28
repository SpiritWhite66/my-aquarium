import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authResponseSchema, sessionListSchema, syncPullResultSchema } from '@aquarium/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningServer, startServer } from './server.js';

// Parcours de connexion de bout en bout : serveur compilé + PostgreSQL réel, e-mails lus sur la sortie.
const databaseUrl = process.env['TEST_DATABASE_URL'];
const ORIGIN = 'https://exemple.github.io';
const migrate = fileURLToPath(new URL('../dist/db/migrate.js', import.meta.url));
const COOKIE = '__Host-refresh';

describe.skipIf(databaseUrl === undefined)('comptes (serveur compilé + PostgreSQL)', () => {
  let server: RunningServer;
  const email = `e2e-${String(Date.now())}@exemple.fr`;

  beforeAll(async () => {
    const env = {
      PATH: process.env['PATH'] ?? '',
      CORS_ORIGIN: ORIGIN,
      DATABASE_URL: databaseUrl ?? '',
      JWT_SECRET: 'secret-e2e-0123456789-0123456789-ab',
      ADMIN_EMAILS: email,
      MAIL_TRANSPORT: 'console',
      RATE_LIMIT_MAX: '1000',
    };
    execFileSync(process.execPath, [migrate], { env, stdio: 'ignore' });
    server = await startServer(env);
  });
  afterAll(() => {
    server.stop();
  });

  const json = { 'content-type': 'application/json' };

  async function emailedToken(): Promise<string> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const last = [...server.output().matchAll(/\?token=([\w-]+)/g)].at(-1);
      if (last?.[1] !== undefined) return last[1];
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('aucun e-mail reçu sur la sortie du serveur');
  }

  const cookieOf = (res: Response): string => {
    const line = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`)) ?? '';
    return line.split(';')[0]?.slice(COOKIE.length + 1) ?? '';
  };

  it('connexion par lien magique, renouvellement, appareils, déconnexion', async () => {
    const ask = await fetch(`${server.base}/auth/magic-link`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email }),
    });
    expect(ask.status).toBe(204);
    const token = await emailedToken();

    const noConsent = await fetch(`${server.base}/auth/verify`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token }),
    });
    expect(noConsent.status).toBe(409);

    const verify = await fetch(`${server.base}/auth/verify`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token, consent: { terms: true, age15: true } }),
    });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers.getSetCookie().join(';');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=None/i);
    const first = authResponseSchema.parse(await verify.json());
    expect(first.user).toMatchObject({ email, role: 'admin' });
    const refreshToken = cookieOf(verify);

    const me = await fetch(`${server.base}/me`, {
      headers: { authorization: `Bearer ${first.accessToken}` },
    });
    expect(me.status).toBe(200);

    const refresh = await fetch(`${server.base}/auth/refresh`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${refreshToken}` },
    });
    expect(refresh.status).toBe(200);
    const next = cookieOf(refresh);
    expect(next).not.toBe(refreshToken);
    const renewed = authResponseSchema.parse(await refresh.json());

    const list = await fetch(`${server.base}/me/sessions`, {
      headers: { authorization: `Bearer ${renewed.accessToken}` },
    });
    expect(sessionListSchema.parse(await list.json()).items).toHaveLength(1);

    const replay = await fetch(`${server.base}/auth/refresh`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${refreshToken}` },
    });
    expect(replay.status).toBe(401);

    const afterReplay = await fetch(`${server.base}/me`, {
      headers: { authorization: `Bearer ${renewed.accessToken}` },
    });
    expect(afterReplay.status).toBe(401);
  });

  it('synchronise les données entre deux appareils du même compte', async () => {
    const owner = `synchro-${String(Date.now())}@exemple.fr`;
    await fetch(`${server.base}/auth/magic-link`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: owner }),
    });
    const verify = await fetch(`${server.base}/auth/verify`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token: await emailedToken(), consent: { terms: true, age15: true } }),
    });
    const { accessToken } = authResponseSchema.parse(await verify.json());
    const auth = { authorization: `Bearer ${accessToken}` };

    const push = await fetch(`${server.base}/sync/push`, {
      method: 'POST',
      headers: { ...auth, ...json },
      body: JSON.stringify({
        changes: [
          {
            table: 'tanks',
            id: 't1',
            updatedAt: '2026-10-01T10:00:00.000Z',
            deleted: false,
            data: { id: 't1', name: 'Salon' },
          },
        ],
      }),
    });
    expect(await push.json()).toEqual({ accepted: 1, ignored: 0 });
    const pull = syncPullResultSchema.parse(
      await (await fetch(`${server.base}/sync/pull?after=0`, { headers: auth })).json(),
    );
    expect(pull.changes.map((c) => c.data?.['name'])).toEqual(['Salon']);
  });

  it('supprime le compte en libre-service', async () => {
    const other = `suppr-${String(Date.now())}@exemple.fr`;
    await fetch(`${server.base}/auth/magic-link`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: other }),
    });
    const verify = await fetch(`${server.base}/auth/verify`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token: await emailedToken(), consent: { terms: true, age15: true } }),
    });
    const { accessToken } = authResponseSchema.parse(await verify.json());
    const bearer = { authorization: `Bearer ${accessToken}` };

    const del = await fetch(`${server.base}/me`, { method: 'DELETE', headers: bearer });
    expect(del.status).toBe(204);
    expect((await fetch(`${server.base}/me`, { headers: bearer })).status).toBe(401);
  });

  it('autorise le cookie entre origines (CORS avec identifiants)', async () => {
    const res = await fetch(`${server.base}/auth/refresh`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
