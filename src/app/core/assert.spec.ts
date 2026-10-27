import { describe, expect, it } from 'vitest';
import { must } from './assert';

describe('must', () => {
  it('rend la valeur présente, même si elle est fausse', () => {
    expect(must(0)).toBe(0);
    expect(must('')).toBe('');
    expect(must(false)).toBe(false);
  });

  it('signale une valeur absente avec son nom', () => {
    expect(() => must(undefined, 'le bac')).toThrow('le bac absente');
    expect(() => must(null)).toThrow('valeur absente');
  });
});
