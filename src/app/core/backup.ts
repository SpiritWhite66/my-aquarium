import { Injectable, computed, inject, signal } from '@angular/core';
import { AquariumStore } from './store';
import { daysBetween, localDay, toIsoDate } from './dates';
import { BackupRepo } from './data/backup.repo';
import { readPref, writePref } from './local-prefs';

/** Délai après lequel on rappelle de faire une sauvegarde. */
export const BACKUP_REMINDER_DAYS = 14;

/** `navigator.storage` manque sur certains navigateurs (anciens, ou navigation privée). */
const maybeStorage = (): Partial<StorageManager> | undefined =>
  (navigator as { storage?: StorageManager }).storage;

/**
 * Protection des données locales :
 * - demande au navigateur de ne pas effacer le stockage (sinon il peut le vider s'il manque de place) ;
 * - mémorise la date de la dernière sauvegarde et rappelle d'en faire une.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly store = inject(AquariumStore);
  private readonly backupRepo = inject(BackupRepo);

  /** null : inconnu ou non pris en charge. */
  readonly persisted = signal<boolean | null>(null);
  readonly usage = signal<{ used: number; quota: number } | null>(null);
  readonly lastBackup = signal<string | null>(readPref('lastBackup'));
  private readonly snoozedUntil = signal<string | null>(readPref('backupSnooze'));

  /** Nombre de jours depuis la dernière sauvegarde (null : jamais). */
  readonly daysSince = computed(() => {
    const last = this.lastBackup();
    return last ? daysBetween(localDay(last), this.store.today()) : null;
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
    void this.init();
  }

  private async init(): Promise<void> {
    const storage = maybeStorage();
    if (!storage?.persist || !storage.persisted) return;
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
    const e = await maybeStorage()?.estimate?.();
    if (e?.usage != null && e.quota) this.usage.set({ used: e.usage, quota: e.quota });
  }

  /** Redemande la persistance (après installation de l'app, par exemple). */
  async requestPersist(): Promise<void> {
    this.persisted.set((await maybeStorage()?.persist?.()) ?? null);
  }

  /** Télécharge la sauvegarde complète (photos comprises). */
  async exportNow(): Promise<void> {
    const name = `my-aquarium-${this.store.today()}.zip`;
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker })
      .showSaveFilePicker;
    let exportedAt: string;
    if (picker) {
      // Chrome sur ordinateur : le fichier s'écrit directement sur le disque, même avec des centaines de photos.
      // Le choix du fichier doit venir avant tout traitement long (il exige le clic de l'utilisateur).
      let handle: FileHandle;
      try {
        handle = await picker({
          suggestedName: name,
          types: [{ description: 'Sauvegarde ZIP', accept: { 'application/zip': ['.zip'] } }],
        });
      } catch {
        return; // fenêtre fermée sans choisir de fichier
      }
      const out = await handle.createWritable();
      try {
        ({ exportedAt } = await this.backupRepo.exportArchiveTo({
          write: (chunk) => out.write(chunk),
        }));
        await out.close();
      } catch (err) {
        await out.abort().catch(() => undefined);
        throw err;
      }
    } else {
      const { blob, exportedAt: at } = await this.backupRepo.exportArchive();
      exportedAt = at;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    }
    writePref('lastBackup', exportedAt);
    this.lastBackup.set(exportedAt);
  }

  /** « Plus tard » : on ne rappelle pas avant 3 jours. */
  snooze(): void {
    const until = new Date();
    until.setDate(until.getDate() + 3);
    const iso = toIsoDate(until);
    writePref('backupSnooze', iso);
    this.snoozedUntil.set(iso);
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
}

/** API d'écriture de fichiers (Chrome, ordinateur), absente des types standard. */
interface FileHandle {
  createWritable(): Promise<{
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandle>;
