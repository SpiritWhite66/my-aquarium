import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { todayIso } from './dates';

/** Jour local courant, rafraîchi chaque minute pour passer minuit sans recharger. */
@Injectable({ providedIn: 'root' })
export class Clock {
  readonly today = signal(todayIso());

  constructor() {
    const timer = setInterval(() => { this.today.set(todayIso()); }, 60_000);
    inject(DestroyRef).onDestroy(() => { clearInterval(timer); });
  }
}
