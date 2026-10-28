import type {
  DBCore,
  DBCoreMutateRequest,
  DBCoreTable,
  DBCoreTransaction,
  Dexie,
  Middleware,
  Transaction,
} from 'dexie';
import { SYNC_TABLES, type SyncTable } from '@aquarium/shared/sync-tables';

/** Une modification locale pas encore envoyée au serveur (la dernière par ligne). */
export interface OutboxEntry {
  key: string; // `${table}|${id}`
  table: SyncTable;
  id: string;
  /** Date de la modification : c'est elle qui départage les appareils. */
  at: string;
  /** Change à chaque nouvelle modification : on ne retire de la file que ce qui a été envoyé. */
  rev: number;
}

const SYNCED = new Set<string>(SYNC_TABLES);
const MARK = 'aquariumRemote';
let rev = 0;

/**
 * Marque une transaction comme écriture venue du serveur : elle n'entre pas dans la file d'envoi
 * (sinon chaque ligne reçue repartirait aussitôt).
 */
export function markRemote(tx: Transaction): void {
  (tx.idbtrans as unknown as Record<string, boolean>)[MARK] = true;
}

const isRemote = (trans: DBCoreTransaction): boolean =>
  (trans as unknown as Record<string, boolean | undefined>)[MARK] === true;

const isCustom = (row: unknown): boolean =>
  typeof row === 'object' && row !== null && (row as { source?: unknown }).source === 'custom';

/**
 * Identifiants touchés par une écriture (lus avant pour les suppressions), à la position de
 * l'opération dans la requête ; `null` pour une ligne qui ne voyage pas.
 */
async function touchedIds(
  table: DBCoreTable,
  req: DBCoreMutateRequest,
): Promise<(string | null)[]> {
  const species = table.name === 'species';
  if (req.type === 'deleteRange') {
    const { result } = await table.query({
      trans: req.trans,
      values: true,
      query: { index: table.schema.primaryKey, range: req.range },
    });
    return (result as { id: string }[]).filter((r) => !species || isCustom(r)).map((r) => r.id);
  }
  if (req.type === 'delete') {
    const keys = req.keys as string[];
    if (!species) return keys;
    const rows = await table.getMany({ trans: req.trans, keys });
    return keys.map((k, i) => (isCustom(rows[i]) ? k : null));
  }
  const keys = (req.keys ?? req.values.map((v: { id: string }) => v.id)) as string[];
  // Fiches du catalogue intégré ou en ligne : elles ne voyagent pas.
  if (!species) return keys;
  return keys.map((k, i) => (req.values[i] === undefined || isCustom(req.values[i]) ? k : null));
}

/**
 * Enregistre dans la table `outbox`, dans la même transaction, chaque écriture locale sur une table
 * synchronisée : ajouts, modifications et suppressions, y compris en masse (`where().delete()`,
 * `clear()`, `modify()`). Aucun code métier n'a donc à s'en soucier.
 */
export function installOutbox(db: Dexie, onLocalChange: () => void): void {
  const middleware: Middleware<DBCore> = {
    stack: 'dbcore',
    name: 'outbox',
    // Au plus près d'IndexedDB, sous les middlewares de Dexie : on peut y attendre une lecture sans perdre
    // le contexte de transaction, et on y voit la transaction IndexedDB elle-même (voir `markRemote`).
    level: -10,
    create: (down) => ({
      ...down,
      transaction: (stores, mode, options) =>
        down.transaction(
          mode === 'readwrite' && stores.some((s) => SYNCED.has(s)) && !stores.includes('outbox')
            ? [...stores, 'outbox']
            : stores,
          mode,
          options,
        ),
      table: (name) => {
        const table = down.table(name);
        if (!SYNCED.has(name)) return table;
        return {
          ...table,
          mutate: async (req) => {
            if (isRemote(req.trans)) return table.mutate(req);
            const ids = await touchedIds(table, req);
            const result = await table.mutate(req);
            // Une écriture refusée (clé déjà prise…) ne doit pas partir.
            const failed = new Set(Object.keys(result.failures).map(Number));
            const at = new Date().toISOString();
            const entries: OutboxEntry[] = ids
              .filter(
                (id, i): id is string =>
                  id !== null && (req.type === 'deleteRange' || !failed.has(i)),
              )
              .map((id) => ({
                key: `${name}|${id}`,
                table: name as SyncTable,
                id,
                at,
                rev: ++rev,
              }));
            if (entries.length) {
              await down.table('outbox').mutate({ type: 'put', trans: req.trans, values: entries });
              onLocalChange();
            }
            return result;
          },
        };
      },
    }),
  };
  db.use(middleware);
}
