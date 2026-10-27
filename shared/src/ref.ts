import { z } from 'zod';

/** Plage de valeurs (température, pH…). */
export const rangeSchema = z
  .object({ min: z.number(), max: z.number() })
  .refine((r) => r.min <= r.max, 'min doit être inférieur ou égal à max');

export const faunaInfoSchema = z.object({
  adultSizeCm: z.number().positive(),
  minGroup: z.number().int().positive().optional(),
  minTankLiters: z.number().positive().optional(),
  temperament: z.enum(['peaceful', 'semi-aggressive', 'aggressive']),
  zone: z.enum(['top', 'middle', 'bottom', 'all']),
  diet: z.enum(['herbivore', 'omnivore', 'carnivore']),
  eatsPlants: z.boolean().optional(),
  predation: z.array(z.enum(['shrimp_fry', 'shrimp', 'snails', 'small_fish'])).optional(),
  role: z.string().min(1).optional(),
});

export const floraInfoSchema = z.object({
  light: z.enum(['low', 'medium', 'high']),
  co2: z.enum(['none', 'beneficial', 'required']),
  growth: z.enum(['slow', 'medium', 'fast']),
  placement: z.enum(['foreground', 'midground', 'background', 'epiphyte', 'floating']),
  form: z.string().min(1).optional(),
  propagation: z.array(z.string().min(1)),
  maxHeightCm: z.number().positive().optional(),
});

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'identifiant en minuscules, chiffres et tirets')
  .refine((v) => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'), 'tirets mal placés');

/** Champs d'une fiche espèce modifiables par l'administrateur (corps de `PUT /ref/species/:id`). */
export const speciesInputSchema = z.object({
  kind: z.enum(['fish', 'shrimp', 'snail', 'plant', 'other']),
  scientificName: z.string().min(1).max(200),
  commonNames: z.array(z.string().min(1).max(200)).max(20),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  temp: rangeSchema.optional(),
  ph: rangeSchema.optional(),
  gh: rangeSchema.optional(),
  kh: rangeSchema.optional(),
  fauna: faunaInfoSchema.optional(),
  flora: floraInfoSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type SpeciesInput = z.infer<typeof speciesInputSchema>;

/** Fiche espèce telle que l'API la publie. `deletedAt` non nul : la fiche est retirée du catalogue. */
export const refSpeciesSchema = speciesInputSchema.extend({
  id,
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type RefSpecies = z.infer<typeof refSpeciesSchema>;

export const equipmentInputSchema = z.object({
  type: z.string().min(1).max(60),
  brand: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  specs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type EquipmentInput = z.infer<typeof equipmentInputSchema>;
export const refEquipmentSchema = equipmentInputSchema.extend({
  id,
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type RefEquipment = z.infer<typeof refEquipmentSchema>;

export const consumableInputSchema = z.object({
  type: z.string().min(1).max(60),
  brand: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  unit: z.string().min(1).max(30).optional(),
});
export type ConsumableInput = z.infer<typeof consumableInputSchema>;
export const refConsumableSchema = consumableInputSchema.extend({
  id,
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type RefConsumable = z.infer<typeof refConsumableSchema>;

/** Réponse de `GET /ref/<type>?since=` : les fiches modifiées depuis la date demandée. */
export function refListSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item) });
}

/** Paramètre `since` : date ISO ; absent = tout le référentiel. */
export const sinceQuerySchema = z.object({ since: z.iso.datetime().optional() });
export const idParamSchema = z.object({ id });
