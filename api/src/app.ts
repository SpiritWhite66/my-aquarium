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
import { createBrevoMailer, createConsoleMailer, type Mailer } from './auth/mailer.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerSyncRoutes } from './sync/routes.js';
import { registerPushRoutes } from './push/routes.js';
import { createWebPushSender, type PushSender } from './push/sender.js';
import { registerRefRoutes } from './ref/routes.js';

function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Journaux structurés, sans secret ni donnée personnelle (ADR-0014) : pour chaque requête, seulement
 * la méthode, le chemin (sans paramètres) et le code de réponse. Ni adresse IP, ni en-têtes, ni
 * identifiant de compte. L'IP sert encore, en mémoire seulement, à la limite de débit.
 */
export function loggerOptions(config: Pick<Config, 'LOG_LEVEL'>) {
  return {
    level: config.LOG_LEVEL,
    serializers: {
      req: (req: { method: string; url: string }) => ({
        method: req.method,
        url: req.url.split('?')[0] ?? req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    // Filet de sécurité si un objet de requête est journalisé autrement (erreur, par exemple).
    redact: ['req.headers', 'req.remoteAddress', 'req.ip', 'res.headers'],
  };
}

export function pushSenderFor(config: Config): PushSender | undefined {
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = config;
  if (!publicKey || !privateKey || !subject) return undefined;
  return createWebPushSender({ publicKey, privateKey, subject });
}

export function mailerFor(config: Config): Mailer | undefined {
  if (config.MAIL_TRANSPORT === 'console') {
    return createConsoleMailer((line) => process.stdout.write(`${line}\n`));
  }
  if (config.MAIL_TRANSPORT === 'brevo' && config.BREVO_API_KEY && config.MAIL_FROM) {
    return createBrevoMailer({
      apiKey: config.BREVO_API_KEY,
      from: { email: config.MAIL_FROM, name: config.MAIL_FROM_NAME },
    });
  }
  return undefined;
}

/** Construit l'application sans l'écouter : les tests l'appellent via `inject`. */
export async function buildApp(
  config: Config,
  deps: { db?: Db; mailer?: Mailer; pushSender?: PushSender } = {},
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
  const mailer = deps.mailer ?? mailerFor(config);
  registerAuthRoutes(app, { db, config, mailer, guards });
  registerSyncRoutes(app, { db, guards });
  registerPushRoutes(app, {
    db,
    guards,
    publicKey: config.VAPID_PUBLIC_KEY,
    sender: deps.pushSender ?? pushSenderFor(config),
  });
  registerRefRoutes(app, { db, authorizeWrite: guards.authorizeAdmin });

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
