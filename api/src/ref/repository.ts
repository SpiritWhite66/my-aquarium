import type {
  ConsumableInput,
  EquipmentInput,
  RefConsumable,
  RefEquipment,
  RefSpecies,
  SpeciesInput,
} from '@aquarium/shared';
import { asc, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { consumable, equipment, species } from '../db/schema.js';

/**
 * Accès au référentiel. Les lectures renvoient aussi les fiches supprimées (`deletedAt` non nul) quand
 * `since` est donné, pour que l'appli les retire de sa copie locale ; sans `since`, elles sont omises.
 */

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

type SpeciesRow = typeof species.$inferSelect;
type EquipmentRow = typeof equipment.$inferSelect;
type ConsumableRow = typeof consumable.$inferSelect;

/**
 * Retire les valeurs `null` de la base pour respecter les champs optionnels du contrat
 * (sauf `deletedAt`, où `null` signifie « fiche active »).
 */
function present<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([k, v]) => v !== null || k === 'deletedAt'),
  ) as T;
}

function speciesFromRow(row: SpeciesRow): RefSpecies {
  return present({
    id: row.id,
    kind: row.kind,
    scientificName: row.scientificName,
    commonNames: row.commonNames,
    difficulty: row.difficulty,
    temp: row.temp,
    ph: row.ph,
    gh: row.gh,
    kh: row.kh,
    fauna: row.fauna,
    flora: row.flora,
    notes: row.notes,
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  }) as RefSpecies;
}

const equipmentFromRow = (row: EquipmentRow): RefEquipment => ({
  id: row.id,
  type: row.type,
  brand: row.brand,
  model: row.model,
  specs: row.specs,
  updatedAt: iso(row.updatedAt),
  deletedAt: isoOrNull(row.deletedAt),
});

const consumableFromRow = (row: ConsumableRow): RefConsumable =>
  present({
    id: row.id,
    type: row.type,
    brand: row.brand,
    name: row.name,
    unit: row.unit,
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  }) as RefConsumable;

/** Valeurs d'une fiche espèce pour l'écriture : les champs absents sont remis à vide. */
function speciesValues(input: SpeciesInput) {
  return {
    kind: input.kind,
    scientificName: input.scientificName,
    commonNames: input.commonNames,
    difficulty: input.difficulty ?? null,
    temp: input.temp ?? null,
    ph: input.ph ?? null,
    gh: input.gh ?? null,
    kh: input.kh ?? null,
    fauna: input.fauna ?? null,
    flora: input.flora ?? null,
    notes: input.notes ?? null,
  };
}

export async function listSpecies(db: Db, since: Date | undefined): Promise<RefSpecies[]> {
  const rows = await db
    .select()
    .from(species)
    .where(since ? gt(species.updatedAt, since) : undefined)
    .orderBy(asc(species.updatedAt), asc(species.id));
  return rows.filter((r) => since !== undefined || r.deletedAt === null).map(speciesFromRow);
}

export async function getSpecies(db: Db, id: string): Promise<RefSpecies | undefined> {
  const [row] = await db.select().from(species).where(eq(species.id, id));
  return row?.deletedAt === null ? speciesFromRow(row) : undefined;
}

export async function upsertSpecies(db: Db, id: string, input: SpeciesInput): Promise<RefSpecies> {
  const values = { ...speciesValues(input), deletedAt: null, updatedAt: new Date() };
  const [row] = await db
    .insert(species)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: species.id, set: values })
    .returning();
  if (!row) throw new Error('écriture de la fiche espèce sans retour');
  return speciesFromRow(row);
}

export async function removeSpecies(db: Db, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(species)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(species.id, id))
    .returning({ id: species.id });
  return rows.length > 0;
}

export async function listEquipment(db: Db, since: Date | undefined): Promise<RefEquipment[]> {
  const rows = await db
    .select()
    .from(equipment)
    .where(since ? gt(equipment.updatedAt, since) : undefined)
    .orderBy(asc(equipment.updatedAt), asc(equipment.id));
  return rows.filter((r) => since !== undefined || r.deletedAt === null).map(equipmentFromRow);
}

export async function getEquipment(db: Db, id: string): Promise<RefEquipment | undefined> {
  const [row] = await db.select().from(equipment).where(eq(equipment.id, id));
  return row?.deletedAt === null ? equipmentFromRow(row) : undefined;
}

export async function upsertEquipment(
  db: Db,
  id: string,
  input: EquipmentInput,
): Promise<RefEquipment> {
  const values = { ...input, deletedAt: null, updatedAt: new Date() };
  const [row] = await db
    .insert(equipment)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: equipment.id, set: values })
    .returning();
  if (!row) throw new Error('écriture de la fiche équipement sans retour');
  return equipmentFromRow(row);
}

export async function removeEquipment(db: Db, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(equipment)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(equipment.id, id))
    .returning({ id: equipment.id });
  return rows.length > 0;
}

export async function listConsumables(db: Db, since: Date | undefined): Promise<RefConsumable[]> {
  const rows = await db
    .select()
    .from(consumable)
    .where(since ? gt(consumable.updatedAt, since) : undefined)
    .orderBy(asc(consumable.updatedAt), asc(consumable.id));
  return rows.filter((r) => since !== undefined || r.deletedAt === null).map(consumableFromRow);
}

export async function getConsumable(db: Db, id: string): Promise<RefConsumable | undefined> {
  const [row] = await db.select().from(consumable).where(eq(consumable.id, id));
  return row?.deletedAt === null ? consumableFromRow(row) : undefined;
}

export async function upsertConsumable(
  db: Db,
  id: string,
  input: ConsumableInput,
): Promise<RefConsumable> {
  const values = { ...input, unit: input.unit ?? null, deletedAt: null, updatedAt: new Date() };
  const [row] = await db
    .insert(consumable)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: consumable.id, set: values })
    .returning();
  if (!row) throw new Error('écriture de la fiche consommable sans retour');
  return consumableFromRow(row);
}

export async function removeConsumable(db: Db, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(consumable)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(consumable.id, id))
    .returning({ id: consumable.id });
  return rows.length > 0;
}
