import type { DestroyRef } from '@angular/core';
import { signal, type Signal } from '@angular/core';
import { liveQuery } from 'dexie';

/**
 * Signal tenu à jour par Dexie, dès la création du store. Chaque domaine a son store : une table
 * que l'écran courant n'utilise pas (photos, matériel…) n'est chargée que quand un écran qui en a besoin
 * injecte son store. Pas de chargement à la première lecture : un traitement lancé par un clic
 * (dossier de diagnostic, export) lirait sinon une liste encore vide.
 */
export function liveSignal<T>(
  destroyRef: DestroyRef,
  query: () => Promise<T>,
  initial: T,
): Signal<T> {
  const value = signal<T>(initial);
  const sub = liveQuery(query).subscribe({
    next: (v) => {
      value.set(v);
    },
    error: (e) => {
      // eslint-disable-next-line no-console -- seul moyen de signaler une requête locale en échec
      console.error(e);
    },
  });
  destroyRef.onDestroy(() => {
    sub.unsubscribe();
  });
  return value.asReadonly();
}
