/**
 * Valeur qu'une règle du programme garantit présente (après un filtre, une recherche par identifiant connu…).
 * Si elle manque, c'est un bogue : on le dit tout de suite, au lieu de laisser `undefined` se propager.
 */
export function must<T>(value: T | null | undefined, what = 'valeur'): T {
  if (value == null) throw new Error(`${what} absente : bogue du programme`);
  return value;
}
