import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuth, openTestDb, testDatabaseUrl } from '../../test/db.js';
import type { Db } from '../db/client.js';
import { createMemoryMailer } from './mailer.js';
import { inactivityMail, purgeInactiveAccounts, startRetention } from './retention.js';

describe('message d’inactivité', () => {
  it('prévient, donne le délai et rassure sur les données de l’appareil', () => {
    const mail = inactivityMail('a@exemple.fr');
    expect(mail.to).toBe('a@exemple.fr');
    expect(mail.subject).toContain('supprimé');
    expect(mail.text).toContain('30 jours');
    expect(mail.text).toContain('sur ton appareil');
  });
});

describe('planification', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lance la purge après le délai initial puis à intervalle régulier, jusqu’à l’arrêt', async () => {
    vi.useFakeTimers();
    const execute = vi.fn();
    // Une base minimale : la purge sans service d'e-mails ne lit rien.
    const log = vi.fn();
    const stop = startRetention({
      db: { execute } as never,
      mailer: undefined,
      log,
      onError: vi.fn(),
      firstRunMs: 1000,
      everyMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ warned: 0, deleted: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(log).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('signale une erreur sans arrêter la planification', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const failing = {
      select: () => {
        throw new Error('base absente');
      },
    };
    const stop = startRetention({
      db: failing as never,
      mailer: createMemoryMailer(),
      log: vi.fn(),
      onError,
      firstRunMs: 10,
      everyMs: 100,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe.skipIf(testDatabaseUrl === undefined)('conservation des comptes (PostgreSQL réel)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let mailer: ReturnType<typeof createMemoryMailer>;

  const addUser = async (email: string, lastSeen: string | null, warned: string | null = null) => {
    await db.execute(sql`
      insert into auth.users (email, created_at, last_seen_at, inactivity_warned_at)
      values (${email}, ${lastSeen ?? '2020-01-01'}::timestamptz,
              ${lastSeen}::timestamptz, ${warned}::timestamptz)`);
  };
  const emails = async (): Promise<string[]> =>
    (await db.execute<{ email: string }>(sql`select email from auth.users order by 1`)).map(
      (r) => r.email,
    );

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await clearAuth(db);
    mailer = createMemoryMailer();
  });

  async function daysAgo(n: number): Promise<string> {
    const [row] = await db.execute<{ t: string }>(
      sql`select (now() - ${`${String(n)} days`}::interval)::text as t`,
    );
    return row?.t ?? '';
  }

  it('avertit un compte inactif depuis plus de 12 mois, une seule fois', async () => {
    await addUser('inactif@exemple.fr', await daysAgo(400));
    await addUser('recent@exemple.fr', await daysAgo(30));
    await addUser('limite@exemple.fr', await daysAgo(360));

    expect(await purgeInactiveAccounts(db, mailer)).toEqual({ warned: 1, deleted: 0 });
    expect(mailer.sent.map((m) => m.to)).toEqual(['inactif@exemple.fr']);
    expect(await emails()).toHaveLength(3);

    expect(await purgeInactiveAccounts(db, mailer)).toEqual({ warned: 0, deleted: 0 });
    expect(mailer.sent).toHaveLength(1);
  });

  it('compte l’inscription comme activité quand le compte n’a jamais été revu', async () => {
    await db.execute(sql`
      insert into auth.users (email, created_at) values ('jamais@exemple.fr', now() - interval '13 months')`);
    expect((await purgeInactiveAccounts(db, mailer)).warned).toBe(1);
  });

  it('supprime 30 jours après l’avertissement, pas avant', async () => {
    await addUser('vieux@exemple.fr', await daysAgo(500), await daysAgo(31));
    await addUser('attente@exemple.fr', await daysAgo(500), await daysAgo(29));

    expect(await purgeInactiveAccounts(db, mailer)).toEqual({ warned: 0, deleted: 1 });
    expect(await emails()).toEqual(['attente@exemple.fr']);
  });

  it('supprime aussi les liens de connexion, les sessions et les consentements du compte', async () => {
    await addUser('vieux@exemple.fr', await daysAgo(500), await daysAgo(31));
    await db.execute(sql`
      insert into auth.login_tokens (email, token_hash, expires_at)
      values ('vieux@exemple.fr', 'h1', now() + interval '1 hour')`);
    await db.execute(sql`
      insert into auth.sessions (user_id, token_hash, expires_at)
      select id, 's1', now() + interval '1 day' from auth.users`);
    await db.execute(sql`
      insert into auth.user_consents (user_id, document, version) select id, 'cgu', '1' from auth.users`);

    await purgeInactiveAccounts(db, mailer);
    for (const table of ['users', 'login_tokens', 'sessions', 'user_consents']) {
      const [row] = await db.execute<{ n: string }>(
        sql`select count(*)::text as n from ${sql.identifier('auth')}.${sql.identifier(table)}`,
      );
      expect(row?.n, table).toBe('0');
    }
  });

  it('ne supprime jamais sans service d’e-mails ni sans avertissement préalable', async () => {
    await addUser('vieux@exemple.fr', await daysAgo(900));
    expect(await purgeInactiveAccounts(db, undefined)).toEqual({ warned: 0, deleted: 0 });
    // Même très inactif, un compte non averti reste : l'avertissement passe toujours en premier.
    expect(await purgeInactiveAccounts(db, mailer)).toEqual({ warned: 1, deleted: 0 });
    expect(await emails()).toEqual(['vieux@exemple.fr']);
  });

  it('ne marque pas le compte quand l’envoi échoue, et réessaie ensuite', async () => {
    await addUser('inactif@exemple.fr', await daysAgo(400));
    const failing = { send: () => Promise.reject(new Error('panne')) };
    expect(await purgeInactiveAccounts(db, failing)).toEqual({ warned: 0, deleted: 0 });
    expect(await purgeInactiveAccounts(db, mailer)).toEqual({ warned: 1, deleted: 0 });
  });

  it('un compte qui se reconnecte après l’avertissement n’est plus concerné', async () => {
    await addUser('revenu@exemple.fr', await daysAgo(5), null);
    // Un avertissement ancien mais une activité récente : remis à zéro à la connexion, jamais supprimé.
    await db.execute(sql`update auth.users set inactivity_warned_at = null`);
    expect(await purgeInactiveAccounts(db, mailer)).toEqual({ warned: 0, deleted: 0 });
    expect(await emails()).toEqual(['revenu@exemple.fr']);
  });
});
