import { sql } from 'drizzle-orm';
import { index, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

/** Référentiel public : espèces, équipements, consommables (ADR-0001). */
export const refSchema = pgSchema('ref');

/** Données des utilisateurs, toujours filtrées par `user_id` (étape 4). */
export const aquaSchema = pgSchema('aqua');

/**
 * Colonnes communes à toutes les fiches du référentiel.
 * `status` et `created_by` préparent les propositions d'utilisateurs (plus tard) : au départ,
 * seules des fiches `published` de l'administrateur (`created_by` nul) existent.
 */
const common = {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['published'] })
    .notNull()
    .default('published'),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
  /** Suppression logique : l'appli doit pouvoir retirer la fiche de sa copie locale. */
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
};

export const species = refSchema.table(
  'species',
  {
    ...common,
    kind: text('kind', { enum: ['fish', 'shrimp', 'snail', 'plant', 'other'] }).notNull(),
    scientificName: text('scientific_name').notNull(),
    commonNames: text('common_names')
      .array()
      .notNull()
      .default(sql`'{}'`),
    difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }),
    temp: jsonb('temp').$type<{ min: number; max: number }>(),
    ph: jsonb('ph').$type<{ min: number; max: number }>(),
    gh: jsonb('gh').$type<{ min: number; max: number }>(),
    kh: jsonb('kh').$type<{ min: number; max: number }>(),
    fauna: jsonb('fauna').$type<Record<string, unknown>>(),
    flora: jsonb('flora').$type<Record<string, unknown>>(),
    notes: text('notes'),
  },
  (t) => [index('species_updated_at_idx').on(t.updatedAt)],
);

export const equipment = refSchema.table(
  'equipment',
  {
    ...common,
    type: text('type').notNull(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    specs: jsonb('specs').$type<Record<string, string | number | boolean>>().notNull().default({}),
  },
  (t) => [index('equipment_updated_at_idx').on(t.updatedAt)],
);

export const consumable = refSchema.table(
  'consumable',
  {
    ...common,
    type: text('type').notNull(),
    brand: text('brand').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
  },
  (t) => [index('consumable_updated_at_idx').on(t.updatedAt)],
);
