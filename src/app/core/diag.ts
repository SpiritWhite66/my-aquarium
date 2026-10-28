import { Injectable, signal } from '@angular/core';

export interface DiagEntry {
  at: string;
  /** Requête vers l'API (`GET /sync/pull`) ou événement (`synchronisation`). */
  what: string;
  /** Code HTTP, ou message d'erreur. */
  result: string;
}

const MAX = 30;

/**
 * Journal des derniers échanges avec le serveur, affiché dans Réglages › Détails techniques pour
 * diagnostiquer sans outils de développement (tablette, téléphone). En mémoire seulement, sans
 * jeton ni donnée : uniquement le chemin, le code de réponse et les messages d'erreur.
 */
@Injectable({ providedIn: 'root' })
export class DiagLog {
  readonly entries = signal<DiagEntry[]>([]);

  record(what: string, result: string): void {
    const entry = { at: new Date().toISOString(), what, result };
    this.entries.update((list) => [entry, ...list].slice(0, MAX));
  }
}

/** Retire les paramètres d'une adresse (un lien de connexion ne doit pas apparaître). */
export const pathOnly = (path: string): string => path.split('?')[0] ?? path;
