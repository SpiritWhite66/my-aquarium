import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ApiError, HealthResponse } from '@aquarium/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { createDb, type Db } from './db/client.js';
import { HttpError } from './http-error.js';
import { createGuards } from './auth/guard.js';
import { createConsoleMailer, type Mailer } from './auth/mailer.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerRefRoutes } from './ref/routes.js';

function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/** Journaux structurés, sans secret ni donnée personnelle (ADR-0014). */
export function loggerOptions(config: Pick<Config, 'LOG_LEVEL'>) {
  return {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  };
}

/** Construit l'application sans l'écouter : les tests l'appellent via `inject`. */
export async function buildApp(
  config: Config,
  deps: { db?: Db; mailer?: Mailer } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.NODE_ENV === 'production',
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  });
  await app.register(cookie);
  await app.register(etag);
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  app.get('/health', (): HealthResponse => ({ status: 'ok', version: config.APP_VERSION }));

  let db = deps.db;
  if (db === undefined && config.DATABASE_URL !== undefined) {
    const connection = createDb(config.DATABASE_URL);
    db = connection.db;
    app.addHook('onClose', () => connection.close());
  }
  const guards = createGuards({
    db,
    jwtSecret: config.JWT_SECRET,
    adminToken: config.ADMIN_TOKEN,
    userRateLimitMax: config.USER_RATE_LIMIT_MAX,
  });
  const mailer =
    deps.mailer ??
    (config.MAIL_TRANSPORT === 'console'
      ? createConsoleMailer((line) => process.stdout.write(`${line}\n`))
      : undefined);
  registerAuthRoutes(app, { db, config, mailer, guards });
  registerRefRoutes(app, { db, authorizeWrite: guards.authorizeRefWrite });

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send(errorBody('not_found', 'Ressource introuvable.'));
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof HttpError) {
      void reply.code(error.statusCode).send(errorBody(error.code, error.message));
      return;
    }
    const status =
      error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err: error }, 'erreur interne');
      void reply.code(500).send(errorBody('internal', 'Erreur interne du serveur.'));
      return;
    }
    const code = status === 429 ? 'rate_limited' : 'bad_request';
    const message =
      status === 429 ? 'Trop de requêtes, réessaie un peu plus tard.' : 'Requête invalide.';
    void reply.code(status).send(errorBody(code, message));
  });

  return app;
}
