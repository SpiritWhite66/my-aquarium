import { z } from 'zod';

const isTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Abonnement aux rappels envoyés par le serveur, avec les préférences de l'appareil. */
export const pushSubscriptionSchema = z.object({
  /** Adresse fournie par le service de push du navigateur (Google, Apple, Mozilla…). */
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  /** Heure locale du rappel, HH:MM. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1).max(64).refine(isTimeZone, 'fuseau horaire inconnu'),
  tasks: z.boolean(),
  followUps: z.boolean(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint });

export const pushKeySchema = z.object({ publicKey: z.string().min(1) });
export type PushKey = z.infer<typeof pushKeySchema>;

/** Contenu d'une notification push, lu par le service worker de l'appli. */
export interface PushPayload {
  title: string;
  body: string;
  /** Même étiquette que les rappels locaux : une notification remplace l'autre au lieu de doubler. */
  tag: 'aquarium-daily';
}
