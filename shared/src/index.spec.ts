import { describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from './index.js';

describe('healthResponseSchema', () => {
  it('accepte une réponse valide', () => {
    expect(healthResponseSchema.parse({ status: 'ok', version: '1.2.3' })).toEqual({
      status: 'ok',
      version: '1.2.3',
    });
  });

  it.each([{ status: 'ko', version: '1' }, { status: 'ok', version: '' }, { status: 'ok' }])(
    'refuse %j',
    (value) => {
      expect(healthResponseSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('apiErrorSchema', () => {
  it('exige un code et un message non vides', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'X', message: 'm' } }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ error: { code: '', message: 'm' } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ error: { code: 'X', message: '' } }).success).toBe(false);
  });
});
