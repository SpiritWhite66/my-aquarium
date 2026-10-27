import { pgSchema } from 'drizzle-orm/pg-core';

/** Référentiel public : espèces, équipements, consommables (ADR-0001, étape 2). */
export const refSchema = pgSchema('ref');

/** Données des utilisateurs, toujours filtrées par `user_id` (étape 4). */
export const aquaSchema = pgSchema('aqua');
