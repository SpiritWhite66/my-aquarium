import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

/** Jeton opaque tiré au hasard (lien magique, jeton de renouvellement). */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** Seul ce hachage est stocké : une fuite de la base ne donne aucun jeton utilisable. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const ACCESS_TTL_SECONDS = 15 * 60;
const ALGORITHM = 'HS256';
const ISSUER = 'mes-aquariums';

const key = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export async function signAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${String(ACCESS_TTL_SECONDS)}s`)
    .sign(key(secret));
}

/** Renvoie les revendications, ou `undefined` si le jeton est invalide, expiré ou mal signé. */
export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
    });
    const sid = payload['sid'];
    if (typeof payload.sub !== 'string' || typeof sid !== 'string') return undefined;
    return { userId: payload.sub, sessionId: sid };
  } catch {
    return undefined;
  }
}
