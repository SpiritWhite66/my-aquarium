// Sans Zod : importable par l'appli sans alourdir son bundle.

/**
 * Tables de l'appli synchronisées entre appareils. Les photos attendent l'étape 6 (images sur B2) ;
 * pour les espèces, seules les fiches créées par l'utilisateur voyagent.
 */
export const SYNC_TABLES = [
  'tanks',
  'species',
  'inhabitants',
  'inhabitantEvents',
  'waterTests',
  'tasks',
  'logs',
  'observations',
  'equipment',
  'consumables',
  'co2Readings',
  'settingChanges',
  'diagnoses',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Taille maximale d'une ligne (JSON) et nombre de lignes par envoi. */
export const SYNC_MAX_ROW_BYTES = 64 * 1024;
export const SYNC_PUSH_BATCH = 100;
