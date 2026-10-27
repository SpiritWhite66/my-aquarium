import { describe, expect, it } from 'vitest';
import { localDay } from './dates';

describe('localDay', () => {
  it('garde une date simple', () => expect(localDay('2026-10-26')).toBe('2026-10-26'));
  it('repasse un horodatage UTC en jour local', () => {
    const late = new Date(2026, 9, 27, 0, 30); // 27 octobre, 0 h 30 heure locale
    expect(localDay(late.toISOString())).toBe('2026-10-27');
  });
  it('lit une heure locale sans fuseau', () =>
    expect(localDay('2026-10-26T23:50')).toBe('2026-10-26'));
});
