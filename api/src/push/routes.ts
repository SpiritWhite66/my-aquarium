import { pushEndpointSchema, pushSubscriptionSchema, type PushKey } from '@aquarium/shared';
import type { FastifyInstance } from 'fastify';
import type { Guards } from '../auth/guard.js';
import type { Db } from '../db/client.js';
import { HttpError } from '../http-error.js';
import { parse } from '../validation.js';
import { dispatch, removeSubscription, saveSubscription } from './repository.js';
import type { PushSender } from './sender.js';

interface Options {
  db: Db | undefined;
  guards: Guards;
  publicKey: string | undefined;
  sender: PushSender | undefined;
}

/** Rappels envoyés par le serveur, même appli fermée. */
export function registerPushRoutes(
  app: FastifyInstance,
  { db, guards, publicKey, sender }: Options,
): void {
  const need = (): { db: Db; sender: PushSender; publicKey: string } => {
    if (db === undefined || sender === undefined || publicKey === undefined) {
      throw new HttpError(503, 'push_unavailable', 'Les notifications ne sont pas configurées.');
    }
    return { db, sender, publicKey };
  };

  app.get('/push/key', (_req, reply) => {
    const body: PushKey = { publicKey: need().publicKey };
    return reply.header('cache-control', 'public, max-age=3600').send(body);
  });

  app.put('/push/subscription', async (req, reply) => {
    const { user } = await guards.requireUser(req);
    const input = parse(pushSubscriptionSchema, req.body);
    await saveSubscription(need().db, user.id, input);
    return reply.header('cache-control', 'no-store').code(204).send();
  });

  app.delete('/push/subscription', async (req, reply) => {
    const { user } = await guards.requireUser(req);
    const { endpoint } = parse(pushEndpointSchema, req.body);
    await removeSubscription(need().db, user.id, endpoint);
    return reply.header('cache-control', 'no-store').code(204).send();
  });

  // Appelée régulièrement par une tâche planifiée, qui réveille aussi le service.
  app.post('/admin/push-dispatch', async (req, reply) => {
    await guards.authorizeAdmin(req);
    const { db: database, sender: send } = need();
    return reply.header('cache-control', 'no-store').send(await dispatch(database, send));
  });
}
