import { DestroyRef, Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { liveSignal } from './live';
import { DEFAULT_PREFS } from '../reminders';

/** Préférences de cet appareil (non incluses dans les sauvegardes). */
@Injectable({ providedIn: 'root' })
export class PrefsStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly notificationPrefs = liveSignal(this.destroyRef, async () => (await this.db.prefs.get('notifications')) ?? DEFAULT_PREFS, DEFAULT_PREFS);
}
