import { signAccessToken } from '../src/auth/crypto.js';
import type { Db } from '../src/db/client.js';
import { sessions, users } from '../src/db/schema.js';

export const TEST_SECRET = 'secret-de-test-0123456789-0123456789';

/** Compte et session créés directement en base ; renvoie l'en-tête d'autorisation. */
export async function signedInUser(
  db: Db,
  email: string,
): Promise<{ userId: string; headers: { authorization: string } }> {
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  const userId = user?.id ?? '';
  const [session] = await db
    .insert(sessions)
    .values({ userId, tokenHash: `h-${email}`, expiresAt: new Date(Date.now() + 3_600_000) })
    .returning({ id: sessions.id });
  const token = await signAccessToken(TEST_SECRET, { userId, sessionId: session?.id ?? '' });
  return { userId, headers: { authorization: `Bearer ${token}` } };
}
