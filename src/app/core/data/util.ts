import type { Entity } from '../models';

/** Entité à créer : l'id est facultatif, la date de mise à jour est posée par le repository. */
export type New<T extends Entity> = Omit<T, 'id' | 'updatedAt'> & Partial<Pick<T, 'id'>>;

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
