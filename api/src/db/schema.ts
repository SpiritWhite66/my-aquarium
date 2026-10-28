import { sql } from 'drizzle-orm';
import { index, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Référentiel public : espèces, équipements, consommables (ADR-0001). */
export const refSchema = pgSchema('ref');

/** Comptes, sessions, liens de connexion et consentements (étape 3). */
export const authSchema = pgSchema('auth');

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

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const users = authSchema.table('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Adresse normalisée (minuscules) : unique, c'est l'identité du compte. */
  email: text('email').notNull().unique(),
  role: text('role', { enum: ['user', 'admin'] })
    .notNull()
    .default('user'),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
});

/** Lien magique : seul le hachage est stocké, usage unique, durée courte. */
export const loginTokens = authSchema.table(
  'login_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('login_tokens_email_idx').on(t.email, t.createdAt)],
);

/**
 * Un appareil connecté. Le jeton de renouvellement n'est stocké que haché, et tourne à chaque
 * usage : le précédent est gardé pour reconnaître une réutilisation (jeton volé) et révoquer.
 */
export const sessions = authSchema.table(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    previousHash: text('previous_hash'),
    device: text('device').notNull().default(''),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_previous_idx').on(t.previousHash),
  ],
);

/** Acceptations des textes légaux, par version (ADR-0011). */
export const userConsents = authSchema.table(
  'user_consents',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    document: text('document').notNull(),
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.document, t.version] })],
);
