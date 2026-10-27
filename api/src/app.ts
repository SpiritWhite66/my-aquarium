import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ApiError, HealthResponse } from '@aquarium/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';

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
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.NODE_ENV === 'production',
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  app.get('/health', (): HealthResponse => ({ status: 'ok', version: config.APP_VERSION }));

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send(errorBody('not_found', 'Ressource introuvable.'));
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
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
