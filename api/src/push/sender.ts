import type { PushPayload } from '@aquarium/shared';
import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Envoie une notification ; en cas d'échec, l'erreur porte le code HTTP du service de push. */
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

export class PushError extends Error {
  constructor(readonly statusCode: number | undefined) {
    super(`Service de push : ${String(statusCode ?? 'erreur réseau')}`);
  }
}

/** Envoi réel, signé avec les clés VAPID du serveur. */
export function createWebPushSender(vapid: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): PushSender {
  return async (target, payload) => {
    try {
      await webpush.sendNotification(target, JSON.stringify(payload), {
        vapidDetails: vapid,
        TTL: 12 * 60 * 60,
        timeout: 10_000,
      });
    } catch (err) {
      const status = (err as { statusCode?: unknown }).statusCode;
      throw new PushError(typeof status === 'number' ? status : undefined);
    }
  };
}
