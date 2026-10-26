// Contenu des notifications quotidiennes : tâches dues et suivis de diagnostic.
// Calculé à l'avance pour les prochains jours, pour que le service worker n'ait qu'à le lire.

import type { Diagnosis, MaintenanceTask, Tank } from './models';
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
}

export interface Digest {
  title: string;
  body: string;
}

export const DEFAULT_PREFS: NotificationPrefs = { id: 'notifications', enabled: false, time: '09:00', tasks: true, followUps: true };

/** Date du suivi prévu par le dernier diagnostic de chaque bac. */
export function followUpsDue(diagnoses: Diagnosis[], day: string): Diagnosis[] {
  const latest = new Map<string, Diagnosis>();
  for (const d of diagnoses) {
    const prev = latest.get(d.tankId);
    if (!prev || d.date > prev.date) latest.set(d.tankId, d);
  }
  return [...latest.values()].filter((d) => d.followUp && addDays(localDay(d.date), d.followUp.inDays) <= day);
}

/** Notification du jour `day`, ou rien s'il n'y a rien à faire. */
export function digestFor(
  day: string,
  data: { tasks: MaintenanceTask[]; diagnoses: Diagnosis[]; tanks: Tank[] },
  prefs: Pick<NotificationPrefs, 'tasks' | 'followUps'>,
): Digest | undefined {
  const name = new Map(data.tanks.filter((t) => !t.archived).map((t) => [t.id, t.name]));
  const lines: string[] = [];
  let count = 0;
  if (prefs.tasks) {
    const due = data.tasks.filter((t) => t.active && t.nextDue <= day && name.has(t.tankId));
    count += due.length;
    const multi = name.size > 1;
    lines.push(...due.slice(0, 4).map((t) => `${t.label}${multi ? ' (' + name.get(t.tankId) + ')' : ''}`));
    if (due.length > 4) lines.push(`et ${due.length - 4} autre(s)`);
  }
  if (prefs.followUps) {
    const f = followUpsDue(data.diagnoses, day).filter((d) => name.has(d.tankId));
    count += f.length;
    lines.push(...f.map((d) => `Suivi du diagnostic : ${name.get(d.tankId)}`));
  }
  if (!count) return undefined;
  return { title: count > 1 ? `${count} choses à faire pour tes bacs` : 'Une chose à faire pour tes bacs', body: lines.join('\n') };
}

/** Notifications des `days` prochains jours, à partir de `today`. */
export function digestsAhead(today: string, data: Parameters<typeof digestFor>[1], prefs: Parameters<typeof digestFor>[2], days = 14): Record<string, Digest> {
  const out: Record<string, Digest> = {};
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const d = digestFor(day, data, prefs);
    if (d) out[day] = d;
  }
  return out;
}

/** Faut-il montrer la notification maintenant ? */
export function shouldNotify(prefs: NotificationPrefs, now: Date, today: string): Digest | undefined {
  if (!prefs.enabled || prefs.lastShown === today) return undefined;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hm < prefs.time) return undefined;
  return prefs.digests?.[today];
}
