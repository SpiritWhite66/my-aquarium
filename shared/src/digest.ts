// Contenu du rappel quotidien (tâches dues, suivis de diagnostic), commun à l'appli (rappels locaux)
// et au serveur (notifications push). Sans Zod : importable par l'appli sans alourdir son bundle.

export interface Digest {
  title: string;
  body: string;
}

export interface DigestTask {
  tankId: string;
  label: string;
  nextDue: string; // YYYY-MM-DD
  active: boolean;
}

export interface DigestDiagnosis {
  tankId: string;
  date: string; // horodatage ISO
  followUp?: { inDays: number };
}

export interface DigestTank {
  id: string;
  name: string;
  archived: boolean;
}

export interface DigestData {
  tasks: DigestTask[];
  diagnoses: DigestDiagnosis[];
  tanks: DigestTank[];
}

export interface DigestPrefs {
  tasks: boolean;
  followUps: boolean;
}

/** Jour local (YYYY-MM-DD) d'un horodatage : dépend du fuseau de la personne. */
export type ToDay = (iso: string) => string;

/** Ajoute des jours à une date YYYY-MM-DD (calcul sur la date seule, sans fuseau). */
export function addDaysIso(day: string, days: number): string {
  const [y = 0, m = 1, d = 1] = day.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Jour (YYYY-MM-DD) d'un horodatage dans un fuseau donné, par exemple `Europe/Paris`. */
export function dayInZone(iso: string, timeZone: string): string {
  if (iso.length <= 10) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
}

/** Dernier diagnostic de chaque bac dont le suivi est arrivé à échéance au jour `day`. */
export function followUpsDueOn<D extends DigestDiagnosis>(
  diagnoses: D[],
  day: string,
  toDay: ToDay,
): D[] {
  const latest = new Map<string, D>();
  for (const d of diagnoses) {
    const prev = latest.get(d.tankId);
    if (!prev || d.date > prev.date) latest.set(d.tankId, d);
  }
  return [...latest.values()].filter(
    (d) => d.followUp && addDaysIso(toDay(d.date), d.followUp.inDays) <= day,
  );
}

/** Rappel du jour `day`, ou rien s'il n'y a rien à faire. */
export function buildDigest(
  day: string,
  data: DigestData,
  prefs: DigestPrefs,
  toDay: ToDay,
): Digest | undefined {
  const name = new Map(data.tanks.filter((t) => !t.archived).map((t) => [t.id, t.name]));
  const lines: string[] = [];
  let count = 0;
  if (prefs.tasks) {
    const due = data.tasks.filter((t) => t.active && t.nextDue <= day && name.has(t.tankId));
    count += due.length;
    const multi = name.size > 1;
    lines.push(
      ...due.slice(0, 4).map((t) => `${t.label}${multi ? ` (${name.get(t.tankId) ?? ''})` : ''}`),
    );
    if (due.length > 4) lines.push(`et ${String(due.length - 4)} autre(s)`);
  }
  if (prefs.followUps) {
    const f = followUpsDueOn(data.diagnoses, day, toDay).filter((d) => name.has(d.tankId));
    count += f.length;
    lines.push(...f.map((d) => `Suivi du diagnostic : ${name.get(d.tankId) ?? ''}`));
  }
  if (!count) return undefined;
  return {
    title:
      count > 1
        ? `${String(count)} choses à faire pour tes bacs`
        : 'Une chose à faire pour tes bacs',
    body: lines.join('\n'),
  };
}
