import { isDeepStrictEqual } from 'node:util';
import { refSpeciesSchema } from '@aquarium/shared';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { getSpecies, upsertSpecies } from './repository.js';

/** Fichier d'amorçage : une fiche par espèce, saisie à la main ou exportée (jamais générée par IA). */
export const speciesFileSchema = z
  .array(refSpeciesSchema.omit({ updatedAt: true, deletedAt: true }))
  .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'identifiants en double');

export interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Importe les fiches dans le référentiel. Une fiche identique à celle de la base n'est pas réécrite :
 * sa date de modification reste la même et les appareils ne la retéléchargent pas.
 */
export async function importSpecies(db: Db, data: unknown): Promise<ImportReport> {
  const list = speciesFileSchema.parse(data);
  const report: ImportReport = { created: 0, updated: 0, unchanged: 0 };
  for (const { id, ...input } of list) {
    const existing = await getSpecies(db, id);
    if (existing === undefined) {
      await upsertSpecies(db, id, input);
      report.created++;
      continue;
    }
    const { updatedAt: _u, deletedAt: _d, id: _i, ...current } = existing;
    if (isDeepStrictEqual(current, input)) {
      report.unchanged++;
    } else {
      await upsertSpecies(db, id, input);
      report.updated++;
    }
  }
  return report;
}
