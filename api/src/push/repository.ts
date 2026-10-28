import {
  buildDigest,
  dayInZone,
  type DigestData,
  type PushSubscriptionInput,
} from '@aquarium/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pushSubscriptions, records } from '../db/schema.js';
import { PushError, type PushSender } from './sender.js';

/** Un appareil s'abonne (ou met à jour ses préférences). Un abonnement change de compte s'il le faut. */
export async function saveSubscription(
  db: Db,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  const values = {
    userId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    time: input.time,
    timeZone: input.timeZone,
    tasks: input.tasks,
    followUps: input.followUps,
  };
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: input.endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
}

export async function removeSubscription(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ endpoint: pushSubscriptions.endpoint });
  return rows.length > 0;
}

/** Données synchronisées utiles au rappel : bacs, tâches, diagnostics (hors suppressions). */
async function digestData(db: Db, userId: string): Promise<DigestData> {
  const rows = await db
    .select({ table: records.table, data: records.data })
    .from(records)
    .where(
      and(
        eq(records.userId, userId),
        eq(records.deleted, false),
        inArray(records.table, ['tanks', 'tasks', 'diagnoses']),
      ),
    );
  const of = <T>(table: string) => rows.filter((r) => r.table === table).map((r) => r.data as T);
  return {
    tanks: of<DigestData['tanks'][number]>('tanks'),
    tasks: of<DigestData['tasks'][number]>('tasks'),
    diagnoses: of<DigestData['diagnoses'][number]>('diagnoses'),
  };
}

/** Heure (HH:MM) et jour (YYYY-MM-DD) locaux dans un fuseau. */
export function localNow(now: Date, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

export interface DispatchReport {
  sent: number;
  /** Rien à faire ce jour-là, ou heure pas encore atteinte. */
  skipped: number;
  /** Abonnements expirés (désinstallation, autorisation retirée) : supprimés. */
  removed: number;
  /** Échecs passagers : nouvel essai au prochain passage. */
  failed: number;
}

/**
 * Envoie le rappel du jour à chaque appareil dont l'heure est passée, une fois par jour. Appelée
 * régulièrement (minuterie interne quand le service est éveillé, tâche GitHub qui le réveille).
 */
export async function dispatch(
  db: Db,
  send: PushSender,
  now = new Date(),
): Promise<DispatchReport> {
  const report: DispatchReport = { sent: 0, skipped: 0, removed: 0, failed: 0 };
  const subs = await db.select().from(pushSubscriptions);
  const cache = new Map<string, Promise<DigestData>>();
  for (const sub of subs) {
    const local = localNow(now, sub.timeZone);
    if (local.time < sub.time || sub.lastSentOn === local.day) {
      report.skipped += 1;
      continue;
    }
    if (!cache.has(sub.userId)) cache.set(sub.userId, digestData(db, sub.userId));
    const data = await (cache.get(sub.userId) ?? digestData(db, sub.userId));
    const digest = buildDigest(local.day, data, sub, (iso) => dayInZone(iso, sub.timeZone));
    if (digest) {
      try {
        await send(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          { ...digest, tag: 'aquarium-daily' },
        );
        report.sent += 1;
      } catch (err) {
        if (err instanceof PushError && (err.statusCode === 404 || err.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
          report.removed += 1;
        } else {
          report.failed += 1;
        }
        continue;
      }
    } else {
      report.skipped += 1;
    }
    await db
      .update(pushSubscriptions)
      .set({ lastSentOn: local.day })
      .where(eq(pushSubscriptions.endpoint, sub.endpoint));
  }
  return report;
}
