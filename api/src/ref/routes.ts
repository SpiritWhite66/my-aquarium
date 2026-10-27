import { createHash, timingSafeEqual } from 'node:crypto';
import {
  consumableInputSchema,
  equipmentInputSchema,
  idParamSchema,
  sinceQuerySchema,
  speciesInputSchema,
} from '@aquarium/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Db } from '../db/client.js';
import { HttpError } from '../http-error.js';
import * as repo from './repository.js';

/** Les lectures sont publiques et mises en cache : l'appli revalide par ETag. */
const CACHE_CONTROL = 'public, max-age=300, must-revalidate';

function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Chemins seulement : jamais la valeur reçue (elle pourrait contenir autre chose qu'une donnée de fiche).
    const fields = result.error.issues.map((i) => i.path.join('.') || '(corps)').join(', ');
    throw new HttpError(400, 'invalid_request', `Requête invalide : ${fields}.`);
  }
  return result.data;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Vérifie le jeton d'administrateur en temps constant ; sans jeton configuré, l'écriture est fermée. */
function assertAdmin(req: FastifyRequest, adminToken: string | undefined): void {
  if (adminToken === undefined) {
    throw new HttpError(403, 'forbidden', "L'écriture du référentiel est désactivée.");
  }
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!timingSafeEqual(digest(given), digest(adminToken))) {
    throw new HttpError(401, 'unauthorized', 'Jeton administrateur manquant ou invalide.');
  }
}

interface Resource<Input, Output> {
  path: string;
  inputSchema: z.ZodType<Input>;
  list: (db: Db, since: Date | undefined) => Promise<Output[]>;
  get: (db: Db, id: string) => Promise<Output | undefined>;
  upsert: (db: Db, id: string, input: Input) => Promise<Output>;
  remove: (db: Db, id: string) => Promise<boolean>;
}

interface Options {
  db: Db | undefined;
  adminToken: string | undefined;
}

function register<Input, Output>(
  app: FastifyInstance,
  { db, adminToken }: Options,
  r: Resource<Input, Output>,
): void {
  const need = (): Db => {
    if (db === undefined) {
      throw new HttpError(503, 'database_unavailable', 'Base de données non configurée.');
    }
    return db;
  };

  app.get(`/ref/${r.path}`, async (req, reply) => {
    const { since } = parse(sinceQuerySchema, req.query);
    const items = await r.list(need(), since === undefined ? undefined : new Date(since));
    return reply.header('cache-control', CACHE_CONTROL).send({ items });
  });

  app.get(`/ref/${r.path}/:id`, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    const item = await r.get(need(), id);
    if (item === undefined) throw new HttpError(404, 'not_found', 'Fiche introuvable.');
    return reply.header('cache-control', CACHE_CONTROL).send(item);
  });

  app.put(`/ref/${r.path}/:id`, async (req, reply) => {
    assertAdmin(req, adminToken);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(r.inputSchema, req.body);
    return reply.header('cache-control', 'no-store').send(await r.upsert(need(), id, input));
  });

  app.delete(`/ref/${r.path}/:id`, async (req, reply) => {
    assertAdmin(req, adminToken);
    const { id } = parse(idParamSchema, req.params);
    if (!(await r.remove(need(), id))) throw new HttpError(404, 'not_found', 'Fiche introuvable.');
    return reply.code(204).header('cache-control', 'no-store').send();
  });
}

export function registerRefRoutes(app: FastifyInstance, options: Options): void {
  register(app, options, {
    path: 'species',
    inputSchema: speciesInputSchema,
    list: repo.listSpecies,
    get: repo.getSpecies,
    upsert: repo.upsertSpecies,
    remove: repo.removeSpecies,
  });
  register(app, options, {
    path: 'equipment',
    inputSchema: equipmentInputSchema,
    list: repo.listEquipment,
    get: repo.getEquipment,
    upsert: repo.upsertEquipment,
    remove: repo.removeEquipment,
  });
  register(app, options, {
    path: 'consumable',
    inputSchema: consumableInputSchema,
    list: repo.listConsumables,
    get: repo.getConsumable,
    upsert: repo.upsertConsumable,
    remove: repo.removeConsumable,
  });
}
