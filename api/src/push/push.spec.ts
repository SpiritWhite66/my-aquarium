import type { PushPayload } from '@aquarium/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuth, openTestDb, testDatabaseUrl } from '../../test/db.js';
import { signedInUser, TEST_SECRET } from '../../test/session.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { dispatch, localNow } from './repository.js';
import { PushError, type PushTarget } from './sender.js';

describe('localNow', () => {
  it('donne le jour et l’heure dans le fuseau de l’appareil', () => {
    const at = new Date('2026-10-29T22:30:00Z');
    expect(localNow(at, 'Europe/Paris')).toEqual({ day: '2026-10-29', time: '23:30' });
    expect(localNow(at, 'Asia/Tokyo')).toEqual({ day: '2026-10-30', time: '07:30' });
    expect(localNow(new Date('2026-10-30T00:05:00Z'), 'UTC')).toEqual({
      day: '2026-10-30',
      time: '00:05',
    });
  });
});

const sub = (n: number, over: Record<string, unknown> = {}) => ({
  endpoint: `https://push.exemple.fr/abonnement-${String(n)}`,
  keys: { p256dh: 'cle-publique-appareil', auth: 'secret-appareil' },
  time: '09:00',
  timeZone: 'Europe/Paris',
  tasks: true,
  followUps: true,
  ...over,
});

describe.skipIf(testDatabaseUrl === undefined)('rappels push (PostgreSQL réel)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let alice: { userId: string; headers: Record<string, string> };
  let bob: { userId: string; headers: Record<string, string> };
  const sent: { target: PushTarget; payload: PushPayload }[] = [];
  const sender = vi.fn((target: PushTarget, payload: PushPayload) => {
    sent.push({ target, payload });
    return Promise.resolve();
  });

  const config = (extra: Record<string, string> = {}) =>
    loadConfig({
      CORS_ORIGIN: 'https://exemple.github.io',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_MAX: '10000',
      JWT_SECRET: TEST_SECRET,
      VAPID_PUBLIC_KEY: 'cle-publique-vapid-0123456789',
      VAPID_PRIVATE_KEY: 'cle-privee-vapid-0123456789',
      VAPID_SUBJECT: 'mailto:contact@exemple.fr',
      ...extra,
    });

  const subscribe = (who: { headers: Record<string, string> }, body: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/push/subscription',
      headers: who.headers,
      payload: body as object,
    });

  const addRecord = async (userId: string, table: string, data: Record<string, unknown>) => {
    await db.execute(sql`
      insert into aqua.records (user_id, tbl, id, data, updated_at)
      values (${userId}, ${table}, ${String(data['id'])}, ${JSON.stringify(data)}::jsonb, now())`);
  };
  const tank = { id: 'b1', name: 'Salon', archived: false };
  const task = (id: string, nextDue: string) => ({
    id,
    tankId: 'b1',
    label: `Tâche ${id}`,
    nextDue,
    active: true,
  });
  const count = async () => {
    const [row] = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from aqua.push_subscriptions`,
    );
    return Number(row?.n);
  };

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await clearAuth(db);
    sent.length = 0;
    sender.mockClear();
    app = await buildApp(config(), { db, pushSender: sender });
    alice = await signedInUser(db, 'alice@exemple.fr');
    bob = await signedInUser(db, 'bob@exemple.fr');
  });

  it('donne la clé publique, ou 503 sans configuration', async () => {
    const res = await app.inject({ url: '/push/key' });
    expect(res.json()).toEqual({ publicKey: 'cle-publique-vapid-0123456789' });
    const off = await buildApp(
      loadConfig({ CORS_ORIGIN: 'https://exemple.github.io', LOG_LEVEL: 'silent' }),
      { db },
    );
    const none = await off.inject({ url: '/push/key' });
    expect(none.statusCode).toBe(503);
    expect(none.json()).toMatchObject({ error: { code: 'push_unavailable' } });
  });

  it('enregistre, met à jour et retire un abonnement', async () => {
    expect((await subscribe(alice, sub(1))).statusCode).toBe(204);
    expect((await subscribe(alice, sub(1, { time: '20:30' }))).statusCode).toBe(204);
    expect(await count()).toBe(1);
    const [row] = await db.execute<{ time: string }>(sql`select time from aqua.push_subscriptions`);
    expect(row?.time).toBe('20:30');
    const del = await app.inject({
      method: 'DELETE',
      url: '/push/subscription',
      headers: alice.headers,
      payload: { endpoint: sub(1).endpoint },
    });
    expect(del.statusCode).toBe(204);
    expect(await count()).toBe(0);
  });

  it('exige une connexion', async () => {
    expect((await subscribe({ headers: {} }, sub(1))).statusCode).toBe(401);
  });

  it.each([
    ['une adresse non https', sub(1, { endpoint: 'http://push.exemple.fr/x' })],
    ['une heure invalide', sub(1, { time: '25:00' })],
    ['un fuseau inconnu', sub(1, { timeZone: 'Mars/Olympus' })],
    ['des clés manquantes', { ...sub(1), keys: {} }],
  ])('refuse %s', async (_nom, body) => {
    expect((await subscribe(alice, body)).statusCode).toBe(400);
  });

  it('isolation : un compte ne retire pas l’abonnement d’un autre', async () => {
    await subscribe(alice, sub(1));
    await app.inject({
      method: 'DELETE',
      url: '/push/subscription',
      headers: bob.headers,
      payload: { endpoint: sub(1).endpoint },
    });
    expect(await count()).toBe(1);
  });

  it('envoie une fois par jour, après l’heure choisie, le rappel calculé depuis les données synchronisées', async () => {
    await subscribe(alice, sub(1));
    await addRecord(alice.userId, 'tanks', tank);
    await addRecord(alice.userId, 'tasks', task('t1', '2026-10-29'));
    await addRecord(alice.userId, 'tasks', task('t2', '2026-11-05'));

    const before = await dispatch(db, sender, new Date('2026-10-29T07:59:00Z')); // 08:59 à Paris
    expect(before).toEqual({ sent: 0, skipped: 1, removed: 0, failed: 0 });

    const report = await dispatch(db, sender, new Date('2026-10-29T08:01:00Z'));
    expect(report).toEqual({ sent: 1, skipped: 0, removed: 0, failed: 0 });
    expect(sent[0]?.payload).toEqual({
      title: 'Une chose à faire pour tes bacs',
      body: 'Tâche t1',
      tag: 'aquarium-daily',
    });
    expect(sent[0]?.target).toEqual({
      endpoint: sub(1).endpoint,
      keys: { p256dh: 'cle-publique-appareil', auth: 'secret-appareil' },
    });

    await dispatch(db, sender, new Date('2026-10-29T15:00:00Z'));
    expect(sent).toHaveLength(1);
    await dispatch(db, sender, new Date('2026-10-30T08:30:00Z'));
    expect(sent).toHaveLength(2);
  });

  it('n’envoie rien quand rien n’est dû, ni pour les lignes supprimées ou d’un autre compte', async () => {
    await subscribe(alice, sub(1));
    await addRecord(alice.userId, 'tanks', tank);
    await addRecord(bob.userId, 'tanks', tank);
    await addRecord(bob.userId, 'tasks', task('t-bob', '2026-10-01'));
    await addRecord(alice.userId, 'tasks', task('t-suppr', '2026-10-01'));
    await db.execute(sql`update aqua.records set deleted = true, data = null where id = 't-suppr'`);
    const report = await dispatch(db, sender, new Date('2026-10-29T10:00:00Z'));
    expect(report).toEqual({ sent: 0, skipped: 1, removed: 0, failed: 0 });
  });

  it('respecte les préférences de l’appareil (tâches désactivées)', async () => {
    await subscribe(alice, sub(1, { tasks: false }));
    await addRecord(alice.userId, 'tanks', tank);
    await addRecord(alice.userId, 'tasks', task('t1', '2026-10-01'));
    expect((await dispatch(db, sender, new Date('2026-10-29T10:00:00Z'))).sent).toBe(0);
  });

  it('retire un abonnement expiré, réessaie après un échec passager', async () => {
    await subscribe(alice, sub(1));
    await subscribe(alice, sub(2));
    await addRecord(alice.userId, 'tanks', tank);
    await addRecord(alice.userId, 'tasks', task('t1', '2026-10-01'));
    const failing = vi.fn((target: PushTarget) =>
      Promise.reject(new PushError(target.endpoint.endsWith('1') ? 410 : 503)),
    );
    expect(await dispatch(db, failing, new Date('2026-10-29T10:00:00Z'))).toEqual({
      sent: 0,
      skipped: 0,
      removed: 1,
      failed: 1,
    });
    expect(await count()).toBe(1);
    // L'échec passager n'a pas marqué le jour : nouvel essai au passage suivant.
    expect((await dispatch(db, sender, new Date('2026-10-29T10:15:00Z'))).sent).toBe(1);
  });

  it('se lance par la route d’administration', async () => {
    const token = 'jeton-de-test-0123456789-0123456789';
    app = await buildApp(config({ ADMIN_TOKEN: token }), { db, pushSender: sender });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/push-dispatch',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: 0, skipped: 0, removed: 0, failed: 0 });
    expect(
      (await app.inject({ method: 'POST', url: '/admin/push-dispatch', headers: alice.headers }))
        .statusCode,
    ).toBe(403);
  });

  it('les abonnements disparaissent avec le compte', async () => {
    await subscribe(alice, sub(1));
    await app.inject({ method: 'DELETE', url: '/me', headers: alice.headers });
    expect(await count()).toBe(0);
  });
});
