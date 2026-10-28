import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { records, users } from '../db/schema.js';
import type { Mailer } from './mailer.js';
import { deleteAccount } from './repository.js';

/** Un compte sans connexion depuis 12 mois reçoit un avertissement, puis est supprimé 30 jours plus tard. */
const BATCH = 100;

export interface PurgeReport {
  warned: number;
  deleted: number;
  /** Suppressions de plus de 90 jours effacées de la synchronisation. */
  tombstones: number;
}

export function inactivityMail(to: string) {
  return {
    to,
    subject: 'Ton compte Mes aquariums sera bientôt supprimé',
    text: [
      'Bonjour,',
      '',
      "Tu ne t'es pas connecté à Mes aquariums depuis plus d'un an. Sans connexion de ta part dans les 30 jours, ton compte (adresse e-mail et appareils connectés) sera supprimé définitivement.",
      '',
      "Pour le garder, ouvre simplement l'appli et connecte-toi. Les données de tes aquariums restent sur ton appareil, rien n'y change.",
      '',
      "Tu ne souhaites plus de compte ? Tu n'as rien à faire.",
    ].join('\n'),
  };
}

/**
 * Applique la règle de conservation. Un compte n'est jamais supprimé sans avertissement envoyé :
 * sans service d'e-mails, ou si l'envoi échoue, rien n'est ni averti ni supprimé.
 * Se reconnecter remet l'avertissement à zéro (voir `verifyLoginToken` et `rotateSession`).
 */
export async function purgeInactiveAccounts(
  db: Db,
  mailer: Mailer | undefined,
): Promise<PurgeReport> {
  const report: PurgeReport = { warned: 0, deleted: 0, tombstones: 0 };
  report.tombstones = await purgeTombstones(db);
  if (mailer === undefined) return report;

  const expired = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.inactivityWarnedAt),
        lt(users.inactivityWarnedAt, sql`now() - interval '30 days'`),
      ),
    )
    .limit(BATCH);
  for (const { id } of expired) {
    if (await deleteAccount(db, id)) report.deleted += 1;
  }

  const inactive = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        isNull(users.inactivityWarnedAt),
        lt(
          sql`coalesce(${users.lastSeenAt}, ${users.createdAt})`,
          sql`now() - interval '12 months'`,
        ),
      ),
    )
    .limit(BATCH);
  const warnedIds: string[] = [];
  for (const user of inactive) {
    try {
      await mailer.send(inactivityMail(user.email));
      warnedIds.push(user.id);
    } catch {
      // Envoi impossible : le compte n'est pas marqué, on réessaiera à la prochaine passe.
    }
  }
  if (warnedIds.length > 0) {
    await db
      .update(users)
      .set({ inactivityWarnedAt: sql`now()` })
      .where(inArray(users.id, warnedIds));
  }
  report.warned = warnedIds.length;
  return report;
}

/**
 * Une suppression reste 90 jours en base pour que les autres appareils l'apprennent ; ensuite on
 * l'efface. Un appareil resté hors ligne plus longtemps ne saura pas que la ligne a été supprimée :
 * il la garde localement (sans la renvoyer, sauf s'il la modifie).
 */
async function purgeTombstones(db: Db): Promise<number> {
  const rows = await db
    .delete(records)
    .where(and(eq(records.deleted, true), lt(records.updatedAt, sql`now() - interval '90 days'`)))
    .returning({ id: records.id });
  return rows.length;
}

export interface RetentionOptions {
  db: Db;
  mailer: Mailer | undefined;
  /** Journal : ne reçoit que des nombres. */
  log: (report: PurgeReport) => void;
  onError: (err: unknown) => void;
  firstRunMs?: number;
  everyMs?: number;
}

/** Lance la purge une minute après le démarrage puis chaque jour. Renvoie la fonction d'arrêt. */
export function startRetention(options: RetentionOptions): () => void {
  const run = (): void => {
    purgeInactiveAccounts(options.db, options.mailer).then(options.log, options.onError);
  };
  const first = setTimeout(run, options.firstRunMs ?? 60_000);
  const every = setInterval(run, options.everyMs ?? 24 * 60 * 60 * 1000);
  // Ne retiennent pas le processus à l'arrêt.
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
