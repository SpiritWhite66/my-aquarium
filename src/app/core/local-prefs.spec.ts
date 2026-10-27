import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPref, writePref } from './local-prefs';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('préférences de l’appareil', () => {
  it('relit ce qu’on a écrit', () => {
    writePref('theme', 'dark');
    expect(readPref('theme')).toBe('dark');
  });

  it('renvoie null pour une préférence absente', () => {
    expect(readPref('lastBackup')).toBeNull();
  });

  it('ne plante pas quand le stockage est indisponible', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    expect(readPref('theme')).toBeNull();
    expect(() => writePref('theme', 'dark')).not.toThrow();
  });
});
