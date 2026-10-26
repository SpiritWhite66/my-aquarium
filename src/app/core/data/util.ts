import type { Entity } from '../models';

/** Entité à créer : l'id est facultatif, la date de mise à jour est posée par le repository. */
export type New<T extends Entity> = Omit<T, 'id' | 'updatedAt'> & Partial<Pick<T, 'id'>>;

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** Maintenant + `i` ms : garde l'ordre de saisie de plusieurs lignes enregistrées ensemble. */
export const nowPlus = (i: number) => new Date(Date.now() + i).toISOString();
