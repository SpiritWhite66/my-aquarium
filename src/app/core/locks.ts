/**
 * Exécute `fn` sous un verrou partagé entre les onglets de l'appli, sans jamais attendre plus de
 * `waitMs` : Chrome Android gèle les onglets en arrière-plan, et un onglet gelé qui tient le verrou
 * bloquerait les autres indéfiniment. Passé le délai, `fn` s'exécute quand même (sans verrou).
 */
export async function withLock<T>(name: string, waitMs: number, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks) return fn();
  const state = { started: false };
  try {
    return await locks.request(name, { signal: AbortSignal.timeout(waitMs) }, () => {
      state.started = true;
      return fn();
    });
  } catch (err) {
    // Délai dépassé avant d'obtenir le verrou : on n'attend plus. Une erreur de `fn` remonte telle quelle.
    if (state.started) throw err;
    return fn();
  }
}
