import { describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  emailSchema,
  LEGAL_VERSIONS,
  magicLinkRequestSchema,
  verifyRequestSchema,
} from './auth.js';

describe('emailSchema', () => {
  it('normalise : espaces retirés, minuscules', () => {
    expect(emailSchema.parse('  Alice@Exemple.FR ')).toBe('alice@exemple.fr');
  });

  it.each(['', 'alice', 'alice@', '@exemple.fr', `${'a'.repeat(250)}@exemple.fr`])(
    'refuse « %s »',
    (value) => {
      expect(emailSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('magicLinkRequestSchema', () => {
  it('exige une adresse', () => {
    expect(magicLinkRequestSchema.safeParse({}).success).toBe(false);
    expect(magicLinkRequestSchema.parse({ email: 'A@x.fr' })).toEqual({ email: 'a@x.fr' });
  });
});

describe('verifyRequestSchema', () => {
  const token = 'x'.repeat(43);

  it('accepte un lien seul ou avec un consentement complet', () => {
    expect(verifyRequestSchema.safeParse({ token }).success).toBe(true);
    expect(
      verifyRequestSchema.safeParse({ token, consent: { terms: true, age15: true } }).success,
    ).toBe(true);
  });

  it.each([{ terms: true, age15: false }, { terms: false, age15: true }, { terms: true }, {}])(
    'refuse le consentement incomplet %j',
    (consent) => {
      expect(verifyRequestSchema.safeParse({ token, consent }).success).toBe(false);
    },
  );

  it('refuse un lien trop court ou trop long', () => {
    expect(verifyRequestSchema.safeParse({ token: 'court' }).success).toBe(false);
    expect(verifyRequestSchema.safeParse({ token: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('authResponseSchema', () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'a@x.fr',
    role: 'user',
    createdAt: '2026-10-28T10:00:00.000Z',
  };

  it('décrit la réponse de connexion', () => {
    expect(authResponseSchema.safeParse({ accessToken: 'jwt', expiresIn: 900, user }).success).toBe(
      true,
    );
    expect(authResponseSchema.safeParse({ accessToken: '', expiresIn: 900, user }).success).toBe(
      false,
    );
    expect(authResponseSchema.safeParse({ accessToken: 'jwt', expiresIn: 0, user }).success).toBe(
      false,
    );
    expect(
      authResponseSchema.safeParse({
        accessToken: 'jwt',
        expiresIn: 900,
        user: { ...user, role: 'root' },
      }).success,
    ).toBe(false);
  });
});

describe('LEGAL_VERSIONS', () => {
  it('couvre les trois textes acceptés à l’inscription', () => {
    expect(Object.keys(LEGAL_VERSIONS).sort()).toEqual(['age15', 'cgu', 'confidentialite']);
  });
});
