import { describe, expect, it } from 'vitest';
import { localDay } from '../core/dates';
import { daysAgoIso } from './dates.testing';

describe('daysAgoIso', () => {
  it('recule en jours de calendrier, même à travers un changement d’heure', () => {
    // Paris, 27 oct. 2026 à 23 h 30 : le passage à l'heure d'hiver (25 oct.) est dans l'intervalle.
    const from = new Date(2026, 9, 27, 23, 30);
    expect(localDay(daysAgoIso(20, from))).toBe('2026-10-07');
    expect(localDay(daysAgoIso(0, from))).toBe('2026-10-27');
  });
});
