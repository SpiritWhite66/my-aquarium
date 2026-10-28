import { z } from 'zod';
import { SYNC_MAX_ROW_BYTES, SYNC_PUSH_BATCH, SYNC_TABLES } from './sync-tables.js';

export { SYNC_MAX_ROW_BYTES, SYNC_PUSH_BATCH, SYNC_TABLES, type SyncTable } from './sync-tables.js';

const rowSchema = z
  .record(z.string(), z.unknown())
  .refine((d) => JSON.stringify(d).length <= SYNC_MAX_ROW_BYTES, 'ligne trop volumineuse');

export const syncChangeSchema = z
  .object({
    table: z.enum(SYNC_TABLES),
    id: z.string().min(1).max(100),
    /** Date de la modification sur l'appareil : la plus récente gagne. */
    updatedAt: z.iso.datetime(),
    deleted: z.boolean(),
    data: rowSchema.nullable(),
  })
  .refine(
    (c) => (c.deleted ? c.data === null : c.data !== null),
    'data nul si et seulement si supprimé',
  )
  .refine((c) => c.data === null || c.data['id'] === c.id, 'data.id différent de id');
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncPushSchema = z.object({
  changes: z.array(syncChangeSchema).min(1).max(SYNC_PUSH_BATCH),
});
export type SyncPush = z.infer<typeof syncPushSchema>;

export const syncPushResultSchema = z.object({
  /** Modifications retenues ; les autres étaient plus anciennes que celles du serveur. */
  accepted: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
});
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;

export const syncPullQuerySchema = z.object({
  /** Curseur renvoyé par l'appel précédent (0 au départ). */
  after: z.coerce.number().int().nonnegative().default(0),
});

export const syncPullResultSchema = z.object({
  changes: z.array(
    z.object({
      table: z.enum(SYNC_TABLES),
      id: z.string(),
      updatedAt: z.iso.datetime(),
      deleted: z.boolean(),
      data: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  cursor: z.number().int().nonnegative(),
  more: z.boolean(),
});
export type SyncPullResult = z.infer<typeof syncPullResultSchema>;
