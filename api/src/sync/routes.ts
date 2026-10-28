import { syncPullQuerySchema, syncPushSchema } from '@aquarium/shared';
import type { FastifyInstance } from 'fastify';
import type { Guards } from '../auth/guard.js';
import type { Db } from '../db/client.js';
import { HttpError } from '../http-error.js';
import { parse } from '../validation.js';
import { pull, push, QuotaExceeded } from './repository.js';

interface Options {
  db: Db | undefined;
  guards: Guards;
}

/** Synchronisation des données d'aquarium du compte connecté (étapes 4 et 5). */
export function registerSyncRoutes(app: FastifyInstance, { db, guards }: Options): void {
  const need = (): Db => {
    if (db === undefined) {
      throw new HttpError(503, 'database_unavailable', 'Base de données non configurée.');
    }
    return db;
  };

  // Jusqu'à 100 lignes de 64 Ko : le corps peut dépasser la limite générale.
  app.post('/sync/push', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const { user } = await guards.requireUser(req);
    const { changes } = parse(syncPushSchema, req.body);
    try {
      return await reply
        .header('cache-control', 'no-store')
        .send(await push(need(), user.id, changes));
    } catch (err) {
      if (err instanceof QuotaExceeded) {
        throw new HttpError(413, 'quota_exceeded', 'Limite de données du compte atteinte.');
      }
      throw err;
    }
  });

  app.get('/sync/pull', async (req, reply) => {
    const { user } = await guards.requireUser(req);
    const { after } = parse(syncPullQuerySchema, req.query);
    return reply.header('cache-control', 'no-store').send(await pull(need(), user.id, after));
  });
}
