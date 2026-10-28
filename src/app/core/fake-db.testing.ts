// Outils de test : base IndexedDB simulée, indépendante pour chaque test.
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

/** Branche Dexie sur une base simulée neuve (à appeler dans beforeEach). */
export function useFakeIndexedDb(): void {
  Dexie.dependencies.indexedDB = new IDBFactory();
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
}

/**
 * Attend qu'une condition soit vraie (les requêtes IndexedDB sont asynchrones). Délai large : quand
 * toute la suite tourne en parallèle, le démarrage de l'appli simulée peut prendre plus de 2 s.
 */
export async function waitFor(check: () => boolean, ms = 5000, tick?: () => void): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Condition jamais remplie');
    await new Promise((r) => setTimeout(r, 10));
    tick?.();
  }
}
