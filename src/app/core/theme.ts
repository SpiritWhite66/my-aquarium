import { Injectable, effect, signal } from '@angular/core';
import { readPref, writePref } from './local-prefs';

export type ThemeChoice = 'light' | 'dark' | 'auto';

/** Thème clair / sombre / auto, mémorisé sur l'appareil. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly choice = signal<ThemeChoice>(read());

  constructor() {
    effect(() => {
      const c = this.choice();
      const root = document.documentElement;
      if (c === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', c);
      writePref('theme', c);
    });
  }
}

function read(): ThemeChoice {
  const v = readPref('theme');
  return v === 'light' || v === 'dark' ? v : 'auto';
}
