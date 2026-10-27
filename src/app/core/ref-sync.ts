import { Injectable, inject, signal } from '@angular/core';
import type { RefSpecies } from '@aquarium/shared';
import { API_URL } from './api-config';
import { BUILTIN_SPECIES } from './catalog';
import { AQUARIUM_DB } from './db';
import { readPref, writePref } from './local-prefs';
import type { Species, SpeciesKind } from './models';

export type RefSyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

const KINDS: readonly SpeciesKind[] = ['fish', 'shrimp', 'snail', 'plant', 'other'];
const TIMEOUT_MS = 10_000;

/** Garde-fou : une fiche mal formée venue du réseau est ignorée plutôt que de casser le catalogue. */
function isRefSpecies(v: unknown): v is RefSpecies {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    KINDS.includes(o['kind'] as SpeciesKind) &&
    typeof o['scientificName'] === 'string' &&
    Array.isArray(o['commonNames']) &&
    o['commonNames'].every((n) => typeof n === 'string') &&
    typeof o['updatedAt'] === 'string' &&
    (o['deletedAt'] === null || typeof o['deletedAt'] === 'string')
  );
}

function toSpecies(r: RefSpecies): Species {
  return {
    id: r.id,
    updatedAt: r.updatedAt,
    kind: r.kind,
    scientificName: r.scientificName,
    commonNames: r.commonNames,
    source: 'builtin',
    difficulty: r.difficulty,
    temp: r.temp,
    ph: r.ph,
    gh: r.gh,
    kh: r.kh,
    fauna: r.fauna,
    flora: r.flora,
    notes: r.notes,
  };
}

/**
 * Catalogue en ligne, derrière un interrupteur désactivé par défaut (réglage propre à l'appareil).
 * Désactivé, l'appli se comporte exactement comme avant : seul le catalogue intégré est utilisé.
 * Activé, les fiches du serveur sont copiées dans la base locale et mises à jour au démarrage ;
 * hors ligne ou si le serveur ne répond pas, le catalogue local reste utilisable.
 */
@Injectable({ providedIn: 'root' })
export class RefSyncService {
  private readonly db = inject(AQUARIUM_DB);
  private readonly apiUrl = inject(API_URL);

  /** Faux tant qu'aucune adresse d'API n'est configurée. */
  readonly available = this.apiUrl !== null;
  readonly enabled = signal(this.available && readPref('onlineCatalog') === '1');
  readonly status = signal<RefSyncStatus>('idle');

  setEnabled(on: boolean): void {
    if (on && !this.available) return;
    this.enabled.set(on);
    writePref('onlineCatalog', on ? '1' : '0');
    if (on) void this.sync();
  }

  /** Remplit la base locale avec le catalogue intégré. À appeler au démarrage, avant `sync()`. */
  async seedCatalog(): Promise<void> {
    if (!this.enabled()) {
      // Fonctionnement d'origine : le catalogue intégré fait foi à chaque démarrage.
      await this.db.species.bulkPut(BUILTIN_SPECIES);
      return;
    }
    // Déjà synchronisé : le serveur fait foi (une fiche qu'il a retirée ne doit pas revenir).
    if (await this.db.refMeta.get('species')) return;
    // Première activation : le catalogue intégré sert de base, sans écraser une fiche plus récente.
    const existing = await this.db.species.bulkGet(BUILTIN_SPECIES.map((s) => s.id));
    await this.db.species.bulkPut(
      BUILTIN_SPECIES.filter((s, i) => (existing[i]?.updatedAt ?? '') < s.updatedAt),
    );
  }

  /** Met à jour la copie locale depuis le serveur. N'échoue jamais : l'état est dans `status`. */
  async sync(): Promise<void> {
    const url = this.apiUrl;
    if (!this.enabled() || url === null || this.status() === 'syncing') return;
    this.status.set('syncing');
    try {
      const meta = await this.db.refMeta.get('species');
      const since = meta ? `?since=${encodeURIComponent(meta.since)}` : '';
      const res = await fetch(`${url}/ref/species${since}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Réponse ${String(res.status)}`);
      const body = (await res.json()) as { items?: unknown };
      if (!Array.isArray(body.items)) throw new Error('Réponse inattendue');
      await this.apply(body.items.filter(isRefSpecies), meta?.since);
      this.status.set('ok');
    } catch {
      // Hors ligne, serveur endormi ou en panne : le catalogue local continue de servir.
      this.status.set('error');
    }
  }

  private async apply(items: RefSpecies[], previousSince: string | undefined): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.species, this.db.inhabitants, this.db.refMeta],
      async () => {
        const removed = items.filter((i) => i.deletedAt !== null).map((i) => i.id);
        // Une fiche retirée du catalogue reste en local tant qu'un habitant l'utilise.
        const used = new Set<string>();
        for (const id of removed) {
          if ((await this.db.inhabitants.where('speciesId').equals(id).count()) > 0) used.add(id);
        }
        await this.db.species.bulkDelete(removed.filter((id) => !used.has(id)));
        await this.db.species.bulkPut(items.filter((i) => i.deletedAt === null).map(toSpecies));
        const latest = items.reduce(
          (max, i) => (i.updatedAt > max ? i.updatedAt : max),
          previousSince ?? '',
        );
        await this.db.refMeta.put({
          id: 'species',
          since: latest || new Date(0).toISOString(),
          syncedAt: new Date().toISOString(),
        });
      },
    );
  }
}
