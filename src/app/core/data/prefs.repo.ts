import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { newId, now, type New } from './util';
import { DEFAULT_PREFS, type NotificationPrefs } from '../reminders';

/** Préférences de cet appareil (non incluses dans les sauvegardes). */
@Injectable({ providedIn: 'root' })
export class PrefsRepo {
  private readonly db = inject(AQUARIUM_DB);

  async saveNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<void> {
    await this.db.transaction('rw', this.db.prefs, async () => {
      const cur = (await this.db.prefs.get('notifications')) ?? DEFAULT_PREFS;
      await this.db.prefs.put({ ...cur, ...patch, id: 'notifications' });
    });
  }
}
