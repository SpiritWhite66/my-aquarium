import { describe, expect, it } from 'vitest';
import { syncChangeSchema, syncPullQuerySchema, syncPushSchema, SYNC_TABLES } from './sync.js';

const change = {
  table: 'tanks',
  id: 't1',
  updatedAt: '2026-10-01T10:00:00.000Z',
  deleted: false,
  data: { id: 't1', name: 'Salon' },
};

describe('syncChangeSchema', () => {
  it('accepte une ligne et une suppression', () => {
    expect(syncChangeSchema.safeParse(change).success).toBe(true);
    expect(syncChangeSchema.safeParse({ ...change, deleted: true, data: null }).success).toBe(true);
  });

  it.each([
    ['une table inconnue', { ...change, table: 'photos' }],
    ['un id vide', { ...change, id: '', data: { id: '' } }],
    ['un id trop long', { ...change, id: 'x'.repeat(101), data: { id: 'x'.repeat(101) } }],
    ['un id différent', { ...change, data: { id: 't2' } }],
    ['une suppression avec données', { ...change, deleted: true }],
    ['une ligne sans données', { ...change, data: null }],
    ['une date invalide', { ...change, updatedAt: 'hier' }],
    ['une ligne trop lourde', { ...change, data: { id: 't1', n: 'x'.repeat(65 * 1024) } }],
  ])('refuse %s', (_nom, value) => {
    expect(syncChangeSchema.safeParse(value).success).toBe(false);
  });

  it('ne synchronise pas encore les photos (étape 6)', () => {
    expect(SYNC_TABLES).not.toContain('photos');
    expect(SYNC_TABLES).toContain('tanks');
  });
});

describe('syncPushSchema', () => {
  it('accepte de 1 à 100 lignes', () => {
    expect(syncPushSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(syncPushSchema.safeParse({ changes: [change] }).success).toBe(true);
    expect(syncPushSchema.safeParse({ changes: Array(101).fill(change) }).success).toBe(false);
  });
});

describe('syncPullQuerySchema', () => {
  it('part de 0 et refuse un curseur négatif', () => {
    expect(syncPullQuerySchema.parse({})).toEqual({ after: 0 });
    expect(syncPullQuerySchema.parse({ after: '42' })).toEqual({ after: 42 });
    expect(syncPullQuerySchema.safeParse({ after: '-1' }).success).toBe(false);
  });
});
