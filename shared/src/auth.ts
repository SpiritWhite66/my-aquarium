import { z } from 'zod';

/**
 * Versions en vigueur des textes légaux (`docs/legal/`). Les changer exige une nouvelle
 * acceptation à la connexion suivante (ADR-0011).
 */
export const LEGAL_VERSIONS = { cgu: '1', confidentialite: '3', age15: '1' } as const;

/** Adresse normalisée (espaces retirés, minuscules) : c'est l'identité du compte. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const magicLinkRequestSchema = z.object({ email: emailSchema });
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** Consentement donné à l'inscription : cases non pré-cochées, majorité numérique (15 ans). */
export const consentSchema = z.object({ terms: z.literal(true), age15: z.literal(true) });

export const verifyRequestSchema = z.object({
  token: z.string().min(20).max(200),
  consent: consentSchema.optional(),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;

/** Réponse de connexion et de renouvellement : le jeton d'accès reste en mémoire dans l'appli. */
export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  /** Durée de validité du jeton d'accès, en secondes. */
  expiresIn: z.number().int().positive(),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const sessionInfoSchema = z.object({
  id: z.uuid(),
  device: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const sessionListSchema = z.object({ items: z.array(sessionInfoSchema) });
export type SessionList = z.infer<typeof sessionListSchema>;

export const sessionIdParamSchema = z.object({ id: z.uuid() });
