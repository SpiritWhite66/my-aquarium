import { z } from 'zod';

/** Réponse de `GET /health` : l'API répond, sans interroger la base. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Forme unique des erreurs de l'API, lue par le bandeau d'alerte de l'appli. */
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export * from './ref.js';
export * from './auth.js';
export * from './sync.js';
export * from './digest.js';
export * from './push.js';
