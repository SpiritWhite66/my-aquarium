import { describe, expect, it } from 'vitest';
import { hashToken, newToken, signAccessToken, verifyAccessToken } from './crypto.js';

const SECRET = 'secret-de-test-0123456789-0123456789';
const claims = { userId: '11111111-1111-4111-8111-111111111111', sessionId: 'sess-1' };

describe('jetons opaques', () => {
  it('sont longs, aléatoires et en base64url', () => {
    const a = newToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it('le hachage est stable, hexadécimal et ne ressemble pas au jeton', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('jeton d’accès', () => {
  it('se signe et se vérifie', async () => {
    expect(await verifyAccessToken(SECRET, await signAccessToken(SECRET, claims))).toEqual(claims);
  });

  it('refuse un autre secret ou un texte quelconque', async () => {
    const token = await signAccessToken(SECRET, claims);
    expect(await verifyAccessToken('un-autre-secret-0123456789-0123456789', token)).toBeUndefined();
    expect(await verifyAccessToken(SECRET, 'abc')).toBeUndefined();
    expect(await verifyAccessToken(SECRET, '')).toBeUndefined();
  });
});
