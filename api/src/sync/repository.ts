import type { SyncChange, SyncPullResult, SyncPushResult, SyncTable } from '@aquarium/shared';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { records } from '../db/schema.js';

/** Lignes renvoyées par appel de `pull` ; l'appli rappelle tant que `more` est vrai. */
export const PULL_PAGE = 500;
/** Nombre maximal de lignes par compte (suppressions comprises). */
const ROW_QUOTA = 50_000;

export class QuotaExceeded extends Error {}

/**
 * Enregistre les modifications d'un appareil. Règle : la modification la plus récente gagne
 * (date de l'appareil). Une date dans le futur est ramenée à l'heure du serveur, pour qu'un appareil
 * à l'horloge en avance ne gagne pas indéfiniment. Les écritures d'un même compte passent l'une après
 * l'autre (verrou), ce qui garantit que `seq` ne fait que croître pour chaque compte.
 */
export async function push(db: Db, userId: string, changes: SyncChange[]): Promise<SyncPushResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [used] = await tx.select({ n: count() }).from(records).where(eq(records.userId, userId));
    if ((used?.n ?? 0) + changes.length > ROW_QUOTA) throw new QuotaExceeded();

    const serverNow = new Date();
    let accepted = 0;
    for (const change of changes) {
      const at = new Date(change.updatedAt);
      const updatedAt = at > serverNow ? serverNow : at;
      const rows = await tx
        .insert(records)
        .values({
          userId,
          table: change.table,
          id: change.id,
          data: change.data,
          deleted: change.deleted,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [records.userId, records.table, records.id],
          set: {
            data: change.data,
            deleted: change.deleted,
            updatedAt,
            seq: sql`nextval('aqua.records_seq_seq')`,
          },
          // À égalité de date, la version déjà enregistrée reste : le résultat ne dépend pas de l'ordre.
          setWhere: sql`${records.updatedAt} < ${updatedAt.toISOString()}::timestamptz`,
        })
        .returning({ id: records.id });
      accepted += rows.length;
    }
    return { accepted, ignored: changes.length - accepted };
  });
}

/** Modifications du compte écrites après `after`, dans l'ordre d'écriture. */
export async function pull(db: Db, userId: string, after: number): Promise<SyncPullResult> {
  const rows = await db
    .select({
      table: records.table,
      id: records.id,
      updatedAt: records.updatedAt,
      deleted: records.deleted,
      data: records.data,
      seq: records.seq,
    })
    .from(records)
    .where(and(eq(records.userId, userId), gt(records.seq, after)))
    .orderBy(asc(records.seq))
    .limit(PULL_PAGE + 1);
  const page = rows.slice(0, PULL_PAGE);
  return {
    changes: page.map((r) => ({
      table: r.table as SyncTable,
      id: r.id,
      updatedAt: r.updatedAt.toISOString(),
      deleted: r.deleted,
      data: r.data ?? null,
    })),
    cursor: page.at(-1)?.seq ?? after,
    more: rows.length > PULL_PAGE,
  };
}
