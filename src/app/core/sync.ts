import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import type { SyncChange, SyncPullResult, SyncPushResult } from '@aquarium/shared';
import {
  SYNC_MAX_ROW_BYTES,
  SYNC_PUSH_BATCH,
  SYNC_TABLES,
  type SyncTable,
} from '@aquarium/shared/sync-tables';
import { AuthService } from './auth';
import { AQUARIUM_DB, type AquariumDb } from './db';
import { withLock } from './locks';
import { markRemote, type OutboxEntry } from './sync-outbox';

/** Requête vers l'API au nom du compte connecté (`null` : pas connecté ou réseau absent). */
export type SyncRequest = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<Response | null>;

class SyncError extends Error {
  constructor(readonly reason: 'offline' | 'quota' | 'server') {
    super(reason);
  }
}

const SYNCED = new Set<string>(SYNC_TABLES);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const synced = (table: SyncTable, row: unknown): boolean =>
  isObject(row) && (table !== 'species' || row['source'] === 'custom');

/**
 * Échanges avec le serveur, sans Angular (testable avec deux bases qui simulent deux appareils).
 * Ordre : envoyer la file locale, puis recevoir ce qui a changé ailleurs. Le serveur tranche les
 * conflits (la modification la plus récente gagne).
 */
export class SyncEngine {
  constructor(
    private readonly db: AquariumDb,
    private readonly request: SyncRequest,
  ) {}

  async run(userId: string): Promise<void> {
    await this.prepare(userId);
    await this.pushAll();
    await this.pullAll();
  }

  /** Premier passage pour ce compte : toutes les données de l'appareil partent au serveur. */
  private async prepare(userId: string): Promise<void> {
    const meta = await this.db.syncMeta.get('sync');
    if (meta?.userId === userId) return;
    const at = new Date().toISOString();
    for (const table of SYNC_TABLES) {
      const rows = (await this.db.table(table).toArray()) as unknown[];
      const entries: OutboxEntry[] = rows
        .filter((r) => synced(table, r))
        .map((r) => {
          const id = (r as { id: string }).id;
          return { key: `${table}|${id}`, table, id, at, rev: 0 };
        });
      await this.db.outbox.bulkPut(entries);
    }
    await this.db.syncMeta.put({ id: 'sync', userId, cursor: 0 });
  }

  private async pushAll(): Promise<void> {
    for (;;) {
      const batch = await this.db.outbox.limit(SYNC_PUSH_BATCH).toArray();
      if (batch.length === 0) return;
      const changes: SyncChange[] = [];
      const done: OutboxEntry[] = [];
      for (const entry of batch) {
        const row: unknown = await this.db.table(entry.table).get(entry.id);
        const change: SyncChange =
          row === undefined
            ? { table: entry.table, id: entry.id, updatedAt: entry.at, deleted: true, data: null }
            : {
                table: entry.table,
                id: entry.id,
                updatedAt: entry.at,
                deleted: false,
                data: row as Record<string, unknown>,
              };
        // Fiche du catalogue, ou ligne trop lourde : elle ne part pas (le serveur refuserait tout l'envoi).
        const skip =
          (row !== undefined && !synced(entry.table, row)) ||
          JSON.stringify(change.data).length > SYNC_MAX_ROW_BYTES;
        if (!skip) changes.push(change);
        done.push(entry);
      }
      if (changes.length > 0) {
        const res = await this.request('/sync/push', { method: 'POST', body: { changes } });
        if (res === null) throw new SyncError('offline');
        if (res.status === 413) throw new SyncError('quota');
        if (!res.ok) throw new SyncError('server');
        (await res.json()) as SyncPushResult;
      }
      // Seulement ce qui n'a pas été modifié entre-temps : sinon la nouvelle version partira au tour suivant.
      await this.db.transaction('rw', this.db.outbox, async () => {
        for (const entry of done) {
          const current = await this.db.outbox.get(entry.key);
          if (current?.rev === entry.rev) await this.db.outbox.delete(entry.key);
        }
      });
    }
  }

  private async pullAll(): Promise<void> {
    for (;;) {
      const meta = await this.db.syncMeta.get('sync');
      const cursor = meta?.cursor ?? 0;
      const res = await this.request(`/sync/pull?after=${String(cursor)}`);
      if (res === null) throw new SyncError('offline');
      if (!res.ok) throw new SyncError('server');
      const page = (await res.json()) as SyncPullResult;
      await this.apply(page);
      if (!page.more) return;
    }
  }

  private async apply(page: SyncPullResult): Promise<void> {
    const tables = [...SYNC_TABLES.map((t) => this.db.table(t)), this.db.outbox, this.db.syncMeta];
    await this.db.transaction('rw', tables, async (tx) => {
      markRemote(tx);
      for (const change of page.changes) {
        if (!SYNCED.has(change.table)) continue;
        // Modifiée ici depuis l'envoi : la version locale partira au prochain tour, le serveur tranchera.
        if (await this.db.outbox.get(`${change.table}|${change.id}`)) continue;
        const table = this.db.table(change.table);
        if (change.deleted) {
          const local: unknown = await table.get(change.id);
          if (local === undefined || synced(change.table, local)) await table.delete(change.id);
        } else if (synced(change.table, change.data) && change.data?.['id'] === change.id) {
          await table.put(change.data);
        }
      }
      await this.db.syncMeta.update('sync', { cursor: page.cursor });
    });
  }
}

export type SyncStatus = 'off' | 'syncing' | 'ok' | 'offline' | 'quota' | 'error';

/** Délai après une modification locale avant d'envoyer : regroupe une saisie en plusieurs étapes. */
const DEBOUNCE_MS = 3000;
const PERIOD_MS = 5 * 60 * 1000;

/**
 * Synchronisation automatique des données du compte connecté : au démarrage et à la connexion, au
 * retour du réseau, quand l'appli revient au premier plan, après une modification et toutes les
 * 5 minutes. Sans compte, rien ne part.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly db = inject(AQUARIUM_DB);
  private readonly auth = inject(AuthService);
  private readonly engine = new SyncEngine(this.db, (path, init) => this.auth.authed(path, init));

  readonly status = signal<SyncStatus>('off');
  readonly lastSync = signal<string | null>(null);
  readonly pending = signal(0);

  private running: Promise<void> | null = null;
  /** Demandes reçues pendant une synchronisation : chacune relance un tour à la fin. */
  private requested = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.db.onLocalChange = () => {
      this.schedule();
    };
    effect(() => {
      if (this.auth.user() === null) this.status.set('off');
      else void this.sync();
    });
    const onOnline = () => void this.sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.sync();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const every = setInterval(() => void this.sync(), PERIOD_MS);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(every);
      clearTimeout(this.timer);
    });
  }

  /** Envoi différé après une modification locale. */
  schedule(): void {
    void this.refreshPending();
    if (this.auth.user() === null) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), DEBOUNCE_MS);
  }

  /** Une seule synchronisation à la fois ; une demande pendant l'exécution relance un tour à la fin. */
  sync(): Promise<void> {
    if (this.running) {
      this.requested += 1;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    let seen: number;
    do {
      seen = this.requested;
      await this.once();
    } while (seen !== this.requested);
  }

  private async once(): Promise<void> {
    const user = this.auth.user();
    if (user === null) return;
    this.status.set('syncing');
    const run = () => this.engine.run(user.id);
    try {
      // Deux onglets ne synchronisent pas en même temps.
      await withLock('aquarium-sync', 20_000, run);
      this.status.set('ok');
      this.lastSync.set(new Date().toISOString());
    } catch (err) {
      if (this.auth.user() === null) this.status.set('off');
      else
        this.status.set(err instanceof SyncError && err.reason !== 'server' ? err.reason : 'error');
    } finally {
      await this.refreshPending();
    }
  }

  private async refreshPending(): Promise<void> {
    try {
      this.pending.set(await this.db.outbox.count());
    } catch {
      // Base fermée (fin de test, onglet qui se ferme) : rien à afficher.
    }
  }
}
