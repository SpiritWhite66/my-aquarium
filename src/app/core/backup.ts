import { Injectable, computed, inject, signal } from '@angular/core';
import { AquariumStore } from './store';
import { daysBetween } from './dates';

/** Délai après lequel on rappelle de faire une sauvegarde. */
export const BACKUP_REMINDER_DAYS = 14;

/**
 * Protection des données locales :
 * - demande au navigateur de ne pas effacer le stockage (sinon il peut le vider s'il manque de place) ;
 * - mémorise la date de la dernière sauvegarde et rappelle d'en faire une.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly store = inject(AquariumStore);

  /** null : inconnu ou non pris en charge. */
  readonly persisted = signal<boolean | null>(null);
  readonly usage = signal<{ used: number; quota: number } | null>(null);
  readonly lastBackup = signal<string | null>(read('lastBackup'));
  private readonly snoozedUntil = signal<string | null>(read('backupSnooze'));

  /** Nombre de jours depuis la dernière sauvegarde (null : jamais). */
  readonly daysSince = computed(() => {
    const last = this.lastBackup();
    return last ? daysBetween(last.slice(0, 10), this.store.today()) : null;
  });

  /** Afficher le rappel : des données existent et la sauvegarde est absente ou ancienne. */
  readonly reminderDue = computed(() => {
    if (!this.store.tanks().length) return false;
    const snooze = this.snoozedUntil();
    if (snooze && snooze > this.store.today()) return false;
    const d = this.daysSince();
    return d === null || d >= BACKUP_REMINDER_DAYS;
  });

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const storage = navigator.storage;
    if (!storage?.persist) return;
    try {
      // Les navigateurs accordent souvent la persistance d'office à une PWA installée.
      const already = await storage.persisted();
      this.persisted.set(already || (await storage.persist()));
      await this.refreshUsage();
    } catch {
      this.persisted.set(null);
    }
  }

  async refreshUsage(): Promise<void> {
    const e = await navigator.storage?.estimate?.();
    if (e?.usage != null && e.quota) this.usage.set({ used: e.usage, quota: e.quota });
  }

  /** Redemande la persistance (après installation de l'app, par exemple). */
  async requestPersist(): Promise<void> {
    this.persisted.set((await navigator.storage?.persist?.()) ?? null);
  }

  /** Télécharge la sauvegarde complète (photos comprises). */
  async exportNow(): Promise<void> {
    const data = await this.store.exportData();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-aquarium-${this.store.today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    write('lastBackup', data.exportedAt);
    this.lastBackup.set(data.exportedAt);
  }

  /** « Plus tard » : on ne rappelle pas avant 3 jours. */
  snooze(): void {
    const until = new Date();
    until.setDate(until.getDate() + 3);
    const iso = until.toISOString().slice(0, 10);
    write('backupSnooze', iso);
    this.snoozedUntil.set(iso);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
}
