import { LEGAL_VERSIONS } from '@aquarium/shared';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { loginTokens, sessions, userConsents, users } from '../db/schema.js';
import { hashToken, newToken } from './crypto.js';

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Demandes de lien magique acceptées par adresse et par heure. */
const MAGIC_LINKS_PER_HOUR = 5;

export interface UserRow {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: Date;
}

const userColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

/** Crée un lien magique ; `undefined` si l'adresse a déjà trop demandé (réponse identique côté client). */
export async function createLoginToken(db: Db, email: string): Promise<string | undefined> {
  await db.delete(loginTokens).where(lt(loginTokens.expiresAt, sql`now() - interval '1 day'`));
  const [recent] = await db
    .select({ n: count() })
    .from(loginTokens)
    .where(
      and(eq(loginTokens.email, email), gt(loginTokens.createdAt, sql`now() - interval '1 hour'`)),
    );
  if ((recent?.n ?? 0) >= MAGIC_LINKS_PER_HOUR) return undefined;
  const token = newToken();
  await db.insert(loginTokens).values({
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  });
  return token;
}

/** Ce que `Db` et une transaction ont en commun. */
type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

type LegalDocument = keyof typeof LEGAL_VERSIONS;
const documents = Object.keys(LEGAL_VERSIONS) as LegalDocument[];

/** Textes dont la version en vigueur n'a pas encore été acceptée par ce compte. */
async function missingConsents(db: Executor, userId: string): Promise<LegalDocument[]> {
  const rows = await db
    .select({ document: userConsents.document, version: userConsents.version })
    .from(userConsents)
    .where(eq(userConsents.userId, userId));
  return documents.filter(
    (d) => !rows.some((r) => r.document === d && r.version === LEGAL_VERSIONS[d]),
  );
}

export type VerifyOutcome =
  | { kind: 'invalid' }
  | { kind: 'consent_required' }
  | { kind: 'ok'; user: UserRow; refreshToken: string; sessionId: string };

/**
 * Échange un lien magique contre une session. Le lien n'est consommé que si le consentement est
 * complet : sinon l'appli peut redemander les cases à cocher puis rappeler avec le même lien.
 */
export async function verifyLoginToken(
  db: Db,
  input: { token: string; consentGiven: boolean; adminEmails: string[]; device: string },
): Promise<VerifyOutcome> {
  const hash = hashToken(input.token);
  return db.transaction(async (tx) => {
    const [login] = await tx
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.tokenHash, hash),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, sql`now()`),
        ),
      )
      .for('update');
    if (login === undefined) return { kind: 'invalid' };

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, login.email));
    const missing = existing === undefined ? documents : await missingConsents(tx, existing.id);
    if (missing.length > 0 && !input.consentGiven) return { kind: 'consent_required' };

    await tx
      .update(loginTokens)
      .set({ usedAt: sql`now()` })
      .where(eq(loginTokens.id, login.id));

    const role = input.adminEmails.includes(login.email) ? 'admin' : 'user';
    const [user] = await tx
      .insert(users)
      .values({ email: login.email, role, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({ target: users.email, set: { role, lastSeenAt: sql`now()` } })
      .returning(userColumns);
    if (user === undefined) throw new Error('création du compte impossible');

    if (missing.length > 0) {
      await tx
        .insert(userConsents)
        .values(
          missing.map((document) => ({
            userId: user.id,
            document,
            version: LEGAL_VERSIONS[document],
          })),
        )
        .onConflictDoNothing();
    }

    const session = await startSession(tx, user.id, input.device);
    return { kind: 'ok', user, ...session };
  });
}

async function startSession(
  db: Executor,
  userId: string,
  device: string,
): Promise<{ refreshToken: string; sessionId: string }> {
  const refreshToken = newToken();
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(refreshToken),
      device,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning({ id: sessions.id });
  if (row === undefined) throw new Error('création de la session impossible');
  return { refreshToken, sessionId: row.id };
}

export type RefreshOutcome =
  { kind: 'invalid' } | { kind: 'ok'; user: UserRow; refreshToken: string; sessionId: string };

/**
 * Renouvelle la session en faisant tourner le jeton. Présenter un jeton déjà remplacé signifie
 * qu'il a été copié : la session entière est révoquée.
 */
export async function rotateSession(db: Db, presented: string): Promise<RefreshOutcome> {
  const hash = hashToken(presented);
  const next = newToken();
  const [rotated] = await db
    .update(sessions)
    .set({
      tokenHash: hashToken(next),
      previousHash: hash,
      lastUsedAt: sql`now()`,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .where(
      and(
        eq(sessions.tokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: sessions.id, userId: sessions.userId });
  if (rotated === undefined) {
    await db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.previousHash, hash), isNull(sessions.revokedAt)));
    return { kind: 'invalid' };
  }
  const [user] = await db
    .update(users)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(users.id, rotated.userId))
    .returning(userColumns);
  if (user === undefined) return { kind: 'invalid' };
  return { kind: 'ok', user, refreshToken: next, sessionId: rotated.id };
}

export async function revokeByRefreshToken(db: Db, presented: string): Promise<void> {
  const hash = hashToken(presented);
  await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.tokenHash, hash), isNull(sessions.revokedAt)));
}

/** Compte et session derrière un jeton d'accès valide ; `undefined` si la session est révoquée ou expirée. */
export async function findActiveSession(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<UserRow | undefined> {
  const [row] = await db
    .select(userColumns)
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    );
  return row;
}

// Les fonctions suivantes prennent toujours `userId` : un compte ne voit que ses appareils.

export async function listSessions(db: Db, userId: string) {
  return db
    .select({
      id: sessions.id,
      device: sessions.device,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(sessions.lastUsedAt));
}

export async function revokeSession(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}
