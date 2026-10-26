// Petites fonctions de dates, en heure locale.

export function todayIso(now = new Date()): string {
  return toIsoDate(now);
}

export function toIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = parseIsoDate(isoDate);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/**
 * Jour local (YYYY-MM-DD) d'une date ou d'un horodatage.
 * Les horodatages sont enregistrés en UTC (« 2026-10-26T23:30:00Z ») : couper la chaîne
 * donnerait la veille entre minuit et 2 h en France, il faut repasser en heure locale.
 */
export function localDay(iso: string): string {
  if (iso.length <= 10) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : toIsoDate(d);
}

export function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = localDay(isoDate).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Nombre de jours entre deux dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 86_400_000);
}
