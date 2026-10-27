/**
 * Horodatage d'il y a `n` jours de calendrier, à la même heure locale.
 * Retirer `n × 24 h` serait faux autour d'un changement d'heure (un jour de 23 h ou 25 h) :
 * le soir, la date tomberait sur le jour voisin.
 */
export function daysAgoIso(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
