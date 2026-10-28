// Contenu des notifications quotidiennes : tâches dues et suivis de diagnostic.
// Calculé à l'avance pour les prochains jours, pour que le service worker n'ait qu'à le lire.

import type { Diagnosis, MaintenanceTask, Tank } from './models';
import { buildDigest, followUpsDueOn, type Digest } from '@aquarium/shared/digest';
import { addDays, localDay } from './dates';

export interface NotificationPrefs {
  id: 'notifications';
  enabled: boolean;
  time: string; // HH:MM
  tasks: boolean;
  followUps: boolean;
  lastShown?: string; // YYYY-MM-DD
  /** Notification prête pour chaque jour à venir (YYYY-MM-DD). */
  digests?: Record<string, Digest>;
  /** Dernier jour pour lequel `digests` est à jour ; au-delà, l'appli n'a plus rien préparé. */
  digestsUntil?: string;
}

export type { Digest };

/** Nombre de jours préparés à l'avance pour le service worker. */
export const DIGEST_DAYS = 30;

/** Texte affiché quand les rappels préparés sont épuisés (appli pas ouverte depuis longtemps). */
export const STALE_DIGEST: Digest = {
  title: 'Rappels à mettre à jour',
  body: 'Ouvre l’appli pour que les rappels de tes bacs continuent.',
};

export const DEFAULT_PREFS: NotificationPrefs = {
  id: 'notifications',
  enabled: false,
  time: '09:00',
  tasks: true,
  followUps: true,
};

/** Date du suivi prévu par le dernier diagnostic de chaque bac. */
export function followUpsDue(diagnoses: Diagnosis[], day: string): Diagnosis[] {
  return followUpsDueOn(diagnoses, day, localDay);
}

/** Notification du jour `day`, ou rien s'il n'y a rien à faire (même calcul que le serveur). */
export function digestFor(
  day: string,
  data: { tasks: MaintenanceTask[]; diagnoses: Diagnosis[]; tanks: Tank[] },
  prefs: Pick<NotificationPrefs, 'tasks' | 'followUps'>,
): Digest | undefined {
  return buildDigest(day, data, prefs, localDay);
}

/** Notifications des `days` prochains jours, à partir de `today`. */
export function digestsAhead(
  today: string,
  data: Parameters<typeof digestFor>[1],
  prefs: Parameters<typeof digestFor>[2],
  days = DIGEST_DAYS,
): Record<string, Digest> {
  const out: Record<string, Digest> = {};
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const d = digestFor(day, data, prefs);
    if (d) out[day] = d;
  }
  return out;
}

/** Faut-il montrer la notification maintenant ? */
export function shouldNotify(
  prefs: NotificationPrefs,
  now: Date,
  today: string,
): Digest | undefined {
  if (!prefs.enabled || prefs.lastShown === today) return undefined;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hm < prefs.time) return undefined;
  const digest = prefs.digests?.[today];
  if (digest) return digest;
  // Plus rien de préparé pour aujourd'hui : on prévient plutôt que de se taire.
  return prefs.digestsUntil && today > prefs.digestsUntil ? STALE_DIGEST : undefined;
}
