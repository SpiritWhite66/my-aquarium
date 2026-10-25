import { Injectable, effect, signal } from '@angular/core';

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
      try {
        localStorage.setItem('theme', c);
      } catch {
        /* stockage indisponible */
      }
    });
  }
}

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem('theme');
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
