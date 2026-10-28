import { authResponseSchema, sessionListSchema, userSchema } from '@aquarium/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuth, clearRef, openTestDb, testDatabaseUrl } from '../../test/db.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { signAccessToken } from './crypto.js';
import { createMemoryMailer, type Mailer } from './mailer.js';
import { REFRESH_COOKIE } from './routes.js';

const ORIGIN = 'https://exemple.github.io';
const SECRET = 'secret-de-test-0123456789-0123456789';
const consent = { terms: true, age15: true };

interface Login {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

describe.skipIf(testDatabaseUrl === undefined)('comptes (PostgreSQL réel)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let mailer: ReturnType<typeof createMemoryMailer>;

  async function start(
    env: Record<string, string> = {},
    useMailer: Mailer | null = mailer,
  ): Promise<FastifyInstance> {
    return buildApp(
      loadConfig({
        CORS_ORIGIN: ORIGIN,
        LOG_LEVEL: 'silent',
        RATE_LIMIT_MAX: '1000',
        JWT_SECRET: SECRET,
        ...env,
      }),
      { db, ...(useMailer === null ? {} : { mailer: useMailer }) },
    );
  }

  const post = (url: string, payload?: object, extra: object = {}) =>
    app.inject({ method: 'POST', url, ...(payload === undefined ? {} : { payload }), ...extra });
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const lastToken = (): string => {
    return /\?token=([\w-]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
  };

  async function login(email: string): Promise<Login> {
    expect((await post('/auth/magic-link', { email })).statusCode).toBe(204);
    const res = await post('/auth/verify', { token: lastToken(), consent });
    expect(res.statusCode).toBe(200);
    const body = authResponseSchema.parse(res.json());
    const refreshToken = res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value ?? '';
    return { accessToken: body.accessToken, refreshToken, userId: body.user.id };
  }

  const refresh = (cookie: string, origin: string | null = ORIGIN) =>
    post('/auth/refresh', undefined, {
      cookies: { [REFRESH_COOKIE]: cookie },
      headers: origin === null ? {} : { origin },
    });

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await clearAuth(db);
    await clearRef(db);
    mailer = createMemoryMailer();
    app = await start();
  });

  describe('lien magique', () => {
    it("envoie un lien, avec la même réponse que l'adresse soit connue ou non", async () => {
      const first = await post('/auth/magic-link', { email: ' Alice@Exemple.fr ' });
      expect(first.statusCode).toBe(204);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe('alice@exemple.fr');
      expect(mailer.sent[0]?.text).toContain(`${ORIGIN}/connexion?token=`);

      await login('alice@exemple.fr');
      const known = await post('/auth/magic-link', { email: 'alice@exemple.fr' });
      expect(known.statusCode).toBe(204);
      expect(known.body).toBe(first.body);
    });

    it('utilise LOGIN_URL quand elle est définie', async () => {
      app = await start({ LOGIN_URL: `${ORIGIN}/mon-appli/#/connexion` });
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      expect(mailer.sent[0]?.text).toContain(`${ORIGIN}/mon-appli/#/connexion?token=`);
    });

    it('refuse une adresse invalide ou un corps absent', async () => {
      expect((await post('/auth/magic-link', { email: 'pas-une-adresse' })).statusCode).toBe(400);
      expect((await post('/auth/magic-link', {})).statusCode).toBe(400);
      expect((await post('/auth/magic-link')).statusCode).toBe(400);
      expect(mailer.sent).toHaveLength(0);
    });

    it('limite à 5 liens par adresse et par heure, sans changer la réponse', async () => {
      for (let i = 0; i < 6; i += 1) {
        expect((await post('/auth/magic-link', { email: 'a@exemple.fr' })).statusCode).toBe(
          i < 5 ? 204 : 429,
        );
      }
    });

    it('limite à 5 demandes par IP et par quart d’heure', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect(
          (await post('/auth/magic-link', { email: `u${String(i)}@exemple.fr` })).statusCode,
        ).toBe(204);
      }
      const res = await post('/auth/magic-link', { email: 'autre@exemple.fr' });
      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    });

    it("ne dépasse pas 5 envois par adresse même si l'IP change", async () => {
      for (let i = 0; i < 5; i += 1) {
        await app.inject({
          method: 'POST',
          url: '/auth/magic-link',
          payload: { email: 'a@exemple.fr' },
          remoteAddress: `10.0.0.${String(i + 1)}`,
        });
      }
      const sixth = await app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: 'a@exemple.fr' },
        remoteAddress: '10.0.0.9',
      });
      expect(sixth.statusCode).toBe(204);
      expect(mailer.sent).toHaveLength(5);
    });

    it("répond 503 sans service d'e-mails et 502 si l'envoi échoue", async () => {
      app = await start({}, null);
      const none = await post('/auth/magic-link', { email: 'a@exemple.fr' });
      expect(none.statusCode).toBe(503);
      expect(none.json()).toMatchObject({ error: { code: 'mail_unavailable' } });

      app = await start({}, { send: () => Promise.reject(new Error('panne')) });
      const failed = await post('/auth/magic-link', { email: 'a@exemple.fr' });
      expect(failed.statusCode).toBe(502);
      expect(JSON.stringify(failed.json())).not.toContain('panne');
    });

    it('écrit les e-mails sur la sortie standard avec MAIL_TRANSPORT=console', async () => {
      const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      let lines: string[];
      try {
        app = await start({ MAIL_TRANSPORT: 'console' }, null);
        await post('/auth/magic-link', { email: 'a@exemple.fr' });
        lines = write.mock.calls.map(([chunk]) => String(chunk));
      } finally {
        write.mockRestore();
      }
      expect(lines.join('')).toContain('/connexion?token=');
    });
  });

  describe('connexion', () => {
    it("demande le consentement d'un nouveau compte sans consommer le lien", async () => {
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const token = lastToken();
      const refused = await post('/auth/verify', { token });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: { code: 'consent_required' } });
      expect(refused.cookies).toHaveLength(0);

      const ok = await post('/auth/verify', { token, consent });
      expect(ok.statusCode).toBe(200);
    });

    it('refuse un consentement incomplet', async () => {
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const res = await post('/auth/verify', {
        token: lastToken(),
        consent: { terms: true, age15: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it('crée le compte, pose le cookie de renouvellement et trace le consentement', async () => {
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const res = await post('/auth/verify', { token: lastToken(), consent });
      const body = authResponseSchema.parse(res.json());
      expect(res.headers['cache-control']).toBe('no-store');
      expect(body.user).toMatchObject({ email: 'a@exemple.fr', role: 'user' });
      expect(body.expiresIn).toBe(900);

      const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE);
      expect(cookie).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        path: '/',
        maxAge: 30 * 24 * 3600,
      });
      expect(cookie?.domain).toBeUndefined();

      const rows = await db.execute<{ document: string; version: string }>(
        sql`select document, version from auth.user_consents order by document`,
      );
      expect([...rows]).toEqual([
        { document: 'age15', version: '1' },
        { document: 'cgu', version: '1' },
        { document: 'confidentialite', version: '2' },
      ]);
    });

    it('ne stocke ni le lien ni le jeton de renouvellement en clair', async () => {
      const { refreshToken } = await login('a@exemple.fr');
      const stored = await db.execute<{ t: string }>(
        sql`select token_hash as t from auth.sessions union all select token_hash from auth.login_tokens`,
      );
      for (const row of stored) {
        expect(row.t).not.toBe(refreshToken);
        expect(row.t).not.toBe(lastToken());
        expect(row.t).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('un lien ne sert qu’une fois', async () => {
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const token = lastToken();
      expect((await post('/auth/verify', { token, consent })).statusCode).toBe(200);
      const again = await post('/auth/verify', { token, consent });
      expect(again.statusCode).toBe(400);
      expect(again.json()).toMatchObject({ error: { code: 'invalid_token' } });
    });

    it('refuse un lien expiré ou inconnu', async () => {
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      await db.execute(sql`update auth.login_tokens set expires_at = now() - interval '1 second'`);
      expect((await post('/auth/verify', { token: lastToken(), consent })).statusCode).toBe(400);
      expect((await post('/auth/verify', { token: 'x'.repeat(43), consent })).statusCode).toBe(400);
    });

    it('ne redemande pas le consentement à un compte à jour, mais le redemande si une version change', async () => {
      await login('a@exemple.fr');
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      expect((await post('/auth/verify', { token: lastToken() })).statusCode).toBe(200);

      await db.execute(sql`update auth.user_consents set version = '0' where document = 'cgu'`);
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const stale = await post('/auth/verify', { token: lastToken() });
      expect(stale.statusCode).toBe(409);
      expect((await post('/auth/verify', { token: lastToken(), consent })).statusCode).toBe(200);
    });

    it('donne le rôle administrateur aux adresses de ADMIN_EMAILS, et seulement à elles', async () => {
      app = await start({ ADMIN_EMAILS: 'Admin@Exemple.fr, autre@exemple.fr' });
      const admin = await login('admin@exemple.fr');
      const user = await login('simple@exemple.fr');
      const role = async (t: string) =>
        userSchema.parse((await app.inject({ url: '/me', headers: bearer(t) })).json()).role;
      expect(await role(admin.accessToken)).toBe('admin');
      expect(await role(user.accessToken)).toBe('user');
    });

    it('répond 503 quand les comptes ne sont pas configurés', async () => {
      app = await buildApp(loadConfig({ CORS_ORIGIN: ORIGIN, LOG_LEVEL: 'silent' }), { mailer });
      for (const [method, url] of [
        ['POST', '/auth/verify'],
        ['POST', '/auth/refresh'],
        ['POST', '/auth/logout'],
        ['POST', '/auth/magic-link'],
        ['GET', '/me'],
      ] as const) {
        const res = await app.inject({ method, url, payload: {} });
        expect(res.statusCode, url).toBe(503);
      }
    });
  });

  describe('renouvellement et déconnexion', () => {
    it('fait tourner le jeton de renouvellement à chaque usage', async () => {
      const first = await login('a@exemple.fr');
      const res = await refresh(first.refreshToken);
      expect(res.statusCode).toBe(200);
      const next = res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value ?? '';
      expect(next).not.toBe('');
      expect(next).not.toBe(first.refreshToken);
      const body = authResponseSchema.parse(res.json());
      expect(body.user.id).toBe(first.userId);
      expect((await refresh(next)).statusCode).toBe(200);
    });

    it('révoque la session quand un ancien jeton est rejoué', async () => {
      const first = await login('a@exemple.fr');
      const second = await refresh(first.refreshToken);
      const current = second.cookies.find((c) => c.name === REFRESH_COOKIE)?.value ?? '';
      const accessToken = authResponseSchema.parse(second.json()).accessToken;

      const replay = await refresh(first.refreshToken);
      expect(replay.statusCode).toBe(401);
      // Le jeton légitime est lui aussi coupé : le voleur et la victime doivent se reconnecter.
      expect((await refresh(current)).statusCode).toBe(401);
      expect((await app.inject({ url: '/me', headers: bearer(accessToken) })).statusCode).toBe(401);
    });

    it('exige un cookie valide et l’origine de l’appli', async () => {
      const { refreshToken } = await login('a@exemple.fr');
      const none = await post('/auth/refresh', undefined, { headers: { origin: ORIGIN } });
      expect(none.statusCode).toBe(401);
      expect(none.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');
      expect((await refresh('inconnu')).statusCode).toBe(401);
      expect((await refresh(refreshToken, null)).statusCode).toBe(403);
      expect((await refresh(refreshToken, 'https://autre.exemple')).statusCode).toBe(403);
      expect((await refresh(refreshToken)).statusCode).toBe(200);
    });

    it('refuse une session expirée', async () => {
      const { refreshToken } = await login('a@exemple.fr');
      await db.execute(sql`update auth.sessions set expires_at = now() - interval '1 second'`);
      expect((await refresh(refreshToken)).statusCode).toBe(401);
    });

    it('déconnecte : le jeton de renouvellement et le jeton d’accès cessent de marcher', async () => {
      const { refreshToken, accessToken } = await login('a@exemple.fr');
      const res = await post('/auth/logout', undefined, {
        cookies: { [REFRESH_COOKIE]: refreshToken },
        headers: { origin: ORIGIN },
      });
      expect(res.statusCode).toBe(204);
      expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');
      expect((await refresh(refreshToken)).statusCode).toBe(401);
      expect((await app.inject({ url: '/me', headers: bearer(accessToken) })).statusCode).toBe(401);
    });

    it("la déconnexion exige l'origine de l'appli et tolère l'absence de cookie", async () => {
      expect((await post('/auth/logout')).statusCode).toBe(403);
      expect(
        (await post('/auth/logout', undefined, { headers: { origin: ORIGIN } })).statusCode,
      ).toBe(204);
    });
  });

  describe('jeton d’accès', () => {
    it('GET /me : le compte connecté', async () => {
      const { accessToken, userId } = await login('a@exemple.fr');
      const res = await app.inject({ url: '/me', headers: bearer(accessToken) });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(userSchema.parse(res.json()).id).toBe(userId);
    });

    it('refuse un jeton absent, mal formé, mal signé, expiré ou sans session', async () => {
      const { userId } = await login('a@exemple.fr');
      const [session] = await db.execute<{ id: string }>(sql`select id from auth.sessions`);
      const sessionId = session?.id ?? '';
      const other = new TextEncoder().encode('un-autre-secret-0123456789-0123456789');
      const wrongKey = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer('mes-aquariums')
        .setExpirationTime('5m')
        .sign(other);
      const expired = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer('mes-aquariums')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(new TextEncoder().encode(SECRET));
      const orphan = await signAccessToken(SECRET, {
        userId,
        sessionId: '00000000-0000-4000-8000-000000000000',
      });
      const noneAlg = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
        JSON.stringify({ sub: userId, sid: sessionId, iss: 'mes-aquariums' }),
      ).toString('base64url')}.`;

      for (const token of ['', 'abc', wrongKey, expired, orphan, noneAlg]) {
        const res = await app.inject({ url: '/me', headers: token === '' ? {} : bearer(token) });
        expect(res.statusCode, token.slice(0, 10)).toBe(401);
        expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
      }
    });

    it('refuse un jeton signé pour une autre session de ce compte supprimée', async () => {
      const { accessToken } = await login('a@exemple.fr');
      await db.execute(sql`delete from auth.sessions`);
      expect((await app.inject({ url: '/me', headers: bearer(accessToken) })).statusCode).toBe(401);
    });

    it('limite le débit par compte', async () => {
      app = await start({ USER_RATE_LIMIT_MAX: '3' });
      const a = await login('a@exemple.fr');
      const b = await login('b@exemple.fr');
      const get = (t: string) => app.inject({ url: '/me', headers: bearer(t) });
      for (let i = 0; i < 3; i += 1) expect((await get(a.accessToken)).statusCode).toBe(200);
      const limited = await get(a.accessToken);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
      // Le quota est propre à chaque compte.
      expect((await get(b.accessToken)).statusCode).toBe(200);
    });

    it('repart d’un quota neuf à la fenêtre suivante', async () => {
      app = await start({ USER_RATE_LIMIT_MAX: '1' });
      const { accessToken } = await login('a@exemple.fr');
      const get = () => app.inject({ url: '/me', headers: bearer(accessToken) });
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(429);
      const realNow = Date.now;
      Date.now = () => realNow() + 61_000;
      try {
        expect((await get()).statusCode).toBe(200);
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe('appareils connectés', () => {
    it('liste les appareils et marque le courant', async () => {
      const a1 = await login('a@exemple.fr');
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const second = await post(
        '/auth/verify',
        { token: lastToken(), consent },
        { headers: { 'user-agent': 'Firefox sur Linux' } },
      );
      const a2 = authResponseSchema.parse(second.json());

      const res = await app.inject({ url: '/me/sessions', headers: bearer(a2.accessToken) });
      const { items } = sessionListSchema.parse(res.json());
      expect(items).toHaveLength(2);
      expect(items.filter((i) => i.current)).toHaveLength(1);
      expect(items.find((i) => i.current)?.device).toBe('Firefox sur Linux');
      expect(a1.accessToken).not.toBe(a2.accessToken);
    });

    it('déconnecte un autre appareil à distance', async () => {
      const phone = await login('a@exemple.fr');
      await post('/auth/magic-link', { email: 'a@exemple.fr' });
      const pc = authResponseSchema.parse(
        (await post('/auth/verify', { token: lastToken(), consent })).json(),
      );
      const { items } = sessionListSchema.parse(
        (await app.inject({ url: '/me/sessions', headers: bearer(pc.accessToken) })).json(),
      );
      const other = items.find((i) => !i.current);

      const del = await app.inject({
        method: 'DELETE',
        url: `/me/sessions/${other?.id ?? ''}`,
        headers: bearer(pc.accessToken),
      });
      expect(del.statusCode).toBe(204);
      expect(
        (await app.inject({ url: '/me', headers: bearer(phone.accessToken) })).statusCode,
      ).toBe(401);
      expect((await refresh(phone.refreshToken)).statusCode).toBe(401);
      expect((await app.inject({ url: '/me', headers: bearer(pc.accessToken) })).statusCode).toBe(
        200,
      );
      const again = await app.inject({
        method: 'DELETE',
        url: `/me/sessions/${other?.id ?? ''}`,
        headers: bearer(pc.accessToken),
      });
      expect(again.statusCode).toBe(404);
    });

    it('isolation : un compte ne voit ni ne révoque les appareils d’un autre', async () => {
      const alice = await login('alice@exemple.fr');
      const bob = await login('bob@exemple.fr');
      const bobs = sessionListSchema.parse(
        (await app.inject({ url: '/me/sessions', headers: bearer(bob.accessToken) })).json(),
      );
      expect(bobs.items).toHaveLength(1);
      const alices = sessionListSchema.parse(
        (await app.inject({ url: '/me/sessions', headers: bearer(alice.accessToken) })).json(),
      );
      expect(alices.items).toHaveLength(1);
      expect(alices.items[0]?.id).not.toBe(bobs.items[0]?.id);

      const attack = await app.inject({
        method: 'DELETE',
        url: `/me/sessions/${bobs.items[0]?.id ?? ''}`,
        headers: bearer(alice.accessToken),
      });
      expect(attack.statusCode).toBe(404);
      expect((await app.inject({ url: '/me', headers: bearer(bob.accessToken) })).statusCode).toBe(
        200,
      );
    });

    it('exige une connexion et un identifiant valide', async () => {
      const { accessToken } = await login('a@exemple.fr');
      expect((await app.inject({ url: '/me/sessions' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: '/me/sessions/x' })).statusCode).toBe(401);
      const bad = await app.inject({
        method: 'DELETE',
        url: '/me/sessions/pas-un-uuid',
        headers: bearer(accessToken),
      });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('suppression du compte', () => {
    const del = (t?: string) =>
      app.inject({ method: 'DELETE', url: '/me', headers: t === undefined ? {} : bearer(t) });
    const count = async (table: string): Promise<number> => {
      const [row] = await db.execute<{ n: string }>(
        sql`select count(*)::text as n from ${sql.identifier('auth')}.${sql.identifier(table)}`,
      );
      return Number(row?.n);
    };

    it('exige une connexion', async () => {
      expect((await del()).statusCode).toBe(401);
      expect((await del('abc')).statusCode).toBe(401);
    });

    it('efface le compte, ses appareils, ses consentements et ses liens en attente', async () => {
      const a = await login('alice@exemple.fr');
      await post('/auth/magic-link', { email: 'alice@exemple.fr' });
      const res = await del(a.accessToken);
      expect(res.statusCode).toBe(204);
      expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');
      for (const table of ['users', 'sessions', 'user_consents', 'login_tokens']) {
        expect(await count(table), table).toBe(0);
      }
    });

    it('coupe aussitôt toutes les sessions du compte', async () => {
      const first = await login('alice@exemple.fr');
      await post('/auth/magic-link', { email: 'alice@exemple.fr' });
      const second = authResponseSchema.parse(
        (await post('/auth/verify', { token: lastToken(), consent })).json(),
      );
      expect((await del(first.accessToken)).statusCode).toBe(204);
      expect(
        (await app.inject({ url: '/me', headers: bearer(second.accessToken) })).statusCode,
      ).toBe(401);
      expect((await refresh(first.refreshToken)).statusCode).toBe(401);
      expect((await del(first.accessToken)).statusCode).toBe(401);
    });

    it('isolation : ne touche à aucune donnée des autres comptes', async () => {
      const alice = await login('alice@exemple.fr');
      const bob = await login('bob@exemple.fr');
      expect((await del(alice.accessToken)).statusCode).toBe(204);
      expect(await count('users')).toBe(1);
      expect(await count('sessions')).toBe(1);
      expect(await count('user_consents')).toBe(3);
      expect((await app.inject({ url: '/me', headers: bearer(bob.accessToken) })).statusCode).toBe(
        200,
      );
    });

    it('permet de se réinscrire ensuite avec la même adresse, en redonnant son consentement', async () => {
      const a = await login('alice@exemple.fr');
      await del(a.accessToken);
      await post('/auth/magic-link', { email: 'alice@exemple.fr' });
      const refused = await post('/auth/verify', { token: lastToken() });
      expect(refused.statusCode).toBe(409);
    });
  });

  describe('purge des comptes inactifs (route d’administration)', () => {
    const purge = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/admin/purge-inactive', headers });

    it('est réservée aux administrateurs', async () => {
      app = await start({ ADMIN_EMAILS: 'admin@exemple.fr' });
      const admin = await login('admin@exemple.fr');
      const user = await login('simple@exemple.fr');
      expect((await purge({})).statusCode).toBe(401);
      expect((await purge(bearer(user.accessToken))).statusCode).toBe(403);
      const ok = await purge(bearer(admin.accessToken));
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ warned: 0, deleted: 0, tombstones: 0 });
      expect(ok.headers['cache-control']).toBe('no-store');
    });

    it('accepte le jeton de secours et avertit les comptes inactifs', async () => {
      const token = 'jeton-de-test-0123456789-0123456789';
      app = await start({ ADMIN_TOKEN: token });
      await login('vieux@exemple.fr');
      mailer.sent.length = 0;
      await db.execute(sql`update auth.users set last_seen_at = now() - interval '13 months'`);
      const res = await purge(bearer(token));
      expect(res.json()).toEqual({ warned: 1, deleted: 0, tombstones: 0 });
      expect(mailer.sent.map((m) => m.to)).toEqual(['vieux@exemple.fr']);
    });

    it('un avertissement est annulé par la reconnexion', async () => {
      const token = 'jeton-de-test-0123456789-0123456789';
      app = await start({ ADMIN_TOKEN: token });
      const a = await login('vieux@exemple.fr');
      await db.execute(sql`update auth.users set last_seen_at = now() - interval '13 months'`);
      await purge(bearer(token));
      const [warned] = await db.execute<{ w: Date | null }>(
        sql`select inactivity_warned_at as w from auth.users`,
      );
      expect(warned?.w).not.toBeNull();
      expect((await refresh(a.refreshToken)).statusCode).toBe(200);
      const [after] = await db.execute<{ w: Date | null }>(
        sql`select inactivity_warned_at as w from auth.users`,
      );
      expect(after?.w).toBeNull();
    });
  });

  describe('écriture du référentiel', () => {
    const species = {
      kind: 'fish',
      scientificName: 'Danio margaritatus',
      commonNames: ['Rasbora galaxy'],
    };
    const put = (headers: Record<string, string>) =>
      app.inject({ method: 'PUT', url: '/ref/species/rasbora-galaxy', headers, payload: species });

    it('accepte une session administrateur, refuse une session simple', async () => {
      app = await start({ ADMIN_EMAILS: 'admin@exemple.fr' });
      const admin = await login('admin@exemple.fr');
      const user = await login('simple@exemple.fr');
      expect((await put(bearer(admin.accessToken))).statusCode).toBe(200);
      const denied = await put(bearer(user.accessToken));
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ error: { code: 'forbidden' } });
      expect((await put({})).statusCode).toBe(401);
    });

    it('garde le jeton de secours quand il est configuré', async () => {
      const token = 'jeton-de-test-0123456789-0123456789';
      app = await start({ ADMIN_TOKEN: token });
      expect((await put(bearer(token))).statusCode).toBe(200);
      expect((await put(bearer('jeton-de-test-faux'))).statusCode).toBe(401);
    });

    it('reste fermée sans jeton ni comptes', async () => {
      app = await buildApp(loadConfig({ CORS_ORIGIN: ORIGIN, LOG_LEVEL: 'silent' }), { db });
      expect((await put({})).statusCode).toBe(403);
    });
  });
});
