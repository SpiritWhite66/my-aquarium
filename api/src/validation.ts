import type { z } from 'zod';
import { HttpError } from './http-error.js';

/** Valide une entrée ; l'erreur ne cite que les chemins en cause, jamais la valeur reçue. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.') || '(corps)').join(', ');
    throw new HttpError(400, 'invalid_request', `Requête invalide : ${fields}.`);
  }
  return result.data;
}
