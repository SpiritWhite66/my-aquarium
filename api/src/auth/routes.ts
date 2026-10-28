import {
  type AuthResponse,
  magicLinkRequestSchema,
  sessionIdParamSchema,
  type SessionList,
  verifyRequestSchema,
} from '@aquarium/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { HttpError } from '../http-error.js';
import { parse } from '../validation.js';
import { ACCESS_TTL_SECONDS, signAccessToken } from './crypto.js';
import type { Guards } from './guard.js';
import { type Mailer, magicLinkMail } from './mailer.js';
import * as repo from './repository.js';

/** `__Host-` : le navigateur refuse le cookie sans `Secure`, sans `Path=/` ou avec un `Domain`. */
export const REFRESH_COOKIE = '__Host-refresh';

const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none', path: '/' } as const;

interface Options {
  db: Db | undefined;
  config: Config;
  mailer: Mailer | undefined;
  guards: Guards;
}

const iso = (d: Date): string => d.toISOString();

export function registerAuthRoutes(
  app: FastifyInstance,
  { db, config, mailer, guards }: Options,
): void {
  const secret = config.JWT_SECRET;
  const loginUrl = config.LOGIN_URL ?? `${config.CORS_ORIGIN}/connexion`;

  const need = (): { db: Db; secret: string } => {
    if (db === undefined || secret === undefined) {
      throw new HttpError(503, 'auth_unavailable', 'Les comptes ne sont pas configurés.');
    }
    return { db, secret };
  };

  /** Les routes à cookie n'acceptent que l'origine de l'appli : protège de la falsification de requête. */
  const assertOrigin = (req: FastifyRequest): void => {
    if (req.headers.origin !== config.CORS_ORIGIN) {
      throw new HttpError(403, 'forbidden', 'Origine non autorisée.');
    }
  };

  const noStore = (reply: FastifyReply): FastifyReply => reply.header('cache-control', 'no-store');

  async function startReply(
    reply: FastifyReply,
    session: { user: repo.UserRow; refreshToken: string; sessionId: string },
  ): Promise<AuthResponse> {
    const accessToken = await signAccessToken(need().secret, {
      userId: session.user.id,
      sessionId: session.sessionId,
    });
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions,
      maxAge: repo.SESSION_TTL_MS / 1000,
    });
    return {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: { ...session.user, createdAt: iso(session.user.createdAt) },
    };
  }

  // Au plus 5 demandes par IP et par quart d'heure ; 5 par adresse et par heure (en base).
  app.post(
    '/auth/magic-link',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { db: database } = need();
      if (mailer === undefined) {
        throw new HttpError(503, 'mail_unavailable', "L'envoi d'e-mails n'est pas configuré.");
      }
      const { email } = parse(magicLinkRequestSchema, req.body);
      const token = await repo.createLoginToken(database, email);
      // Même réponse que l'adresse soit connue ou non, ou que la limite soit atteinte : rien à deviner.
      // eslint-disable-next-line security/detect-possible-timing-attacks -- test d'absence, aucune comparaison de secret
      if (token !== undefined) {
        try {
          await mailer.send(magicLinkMail(email, `${loginUrl}?token=${token}`));
        } catch (err) {
          req.log.error({ err }, "échec d'envoi du lien de connexion");
          throw new HttpError(502, 'mail_failed', "L'e-mail n'a pas pu être envoyé.");
        }
      }
      return noStore(reply).code(204).send();
    },
  );

  app.post(
    '/auth/verify',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { db: database } = need();
      const body = parse(verifyRequestSchema, req.body);
      const outcome = await repo.verifyLoginToken(database, {
        token: body.token,
        consentGiven: body.consent !== undefined,
        adminEmails: config.ADMIN_EMAILS,
        device: (req.headers['user-agent'] ?? '').slice(0, 200),
      });
      if (outcome.kind === 'invalid') {
        throw new HttpError(400, 'invalid_token', 'Lien de connexion invalide ou expiré.');
      }
      if (outcome.kind === 'consent_required') {
        throw new HttpError(
          409,
          'consent_required',
          "Accepte les conditions d'utilisation et la politique de confidentialité pour continuer.",
        );
      }
      return noStore(reply).send(await startReply(reply, outcome));
    },
  );

  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { db: database } = need();
      assertOrigin(req);
      const presented = req.cookies[REFRESH_COOKIE];
      const outcome =
        presented === undefined
          ? ({ kind: 'invalid' } as const)
          : await repo.rotateSession(database, presented);
      if (outcome.kind === 'invalid') {
        void reply.clearCookie(REFRESH_COOKIE, cookieOptions);
        throw new HttpError(401, 'unauthorized', 'Connexion requise ou expirée.');
      }
      return noStore(reply).send(await startReply(reply, outcome));
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    const { db: database } = need();
    assertOrigin(req);
    const presented = req.cookies[REFRESH_COOKIE];
    if (presented !== undefined) await repo.revokeByRefreshToken(database, presented);
    return noStore(reply).clearCookie(REFRESH_COOKIE, cookieOptions).code(204).send();
  });

  app.get('/me', async (req, reply) => {
    const { user } = await guards.requireUser(req);
    return noStore(reply).send({ ...user, createdAt: iso(user.createdAt) });
  });

  app.get('/me/sessions', async (req, reply) => {
    const { user, sessionId } = await guards.requireUser(req);
    const rows = await repo.listSessions(need().db, user.id);
    const body: SessionList = {
      items: rows.map((r) => ({
        id: r.id,
        device: r.device,
        createdAt: iso(r.createdAt),
        lastUsedAt: iso(r.lastUsedAt),
        current: r.id === sessionId,
      })),
    };
    return noStore(reply).send(body);
  });

  app.delete('/me/sessions/:id', async (req, reply) => {
    const { user } = await guards.requireUser(req);
    const { id } = parse(sessionIdParamSchema, req.params);
    if (!(await repo.revokeSession(need().db, user.id, id))) {
      throw new HttpError(404, 'not_found', 'Appareil introuvable.');
    }
    return noStore(reply).code(204).send();
  });
}
