import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DiagLog, pathOnly } from './diag';

describe('DiagLog', () => {
  it('garde les 30 derniers échanges, le plus récent en premier', () => {
    const log = TestBed.inject(DiagLog);
    for (let i = 0; i < 35; i++) log.record(`GET /n${String(i)}`, '200');
    expect(log.entries()).toHaveLength(30);
    expect(log.entries()[0]?.what).toBe('GET /n34');
    expect(log.entries()[29]?.what).toBe('GET /n5');
    expect(Date.parse(log.entries()[0]?.at ?? '')).not.toBeNaN();
  });

  it('retire les paramètres d’une adresse', () => {
    expect(pathOnly('/sync/pull?after=12')).toBe('/sync/pull');
    expect(pathOnly('/me')).toBe('/me');
  });
});
