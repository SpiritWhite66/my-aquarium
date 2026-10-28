import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { HttpError } from '../http-error.js';
import { hashToken, verifyAccessToken } from './crypto.js';
import { findActiveSession, type UserRow } from './repository.js';

interface AuthContext {
  user: UserRow;
  sessionId: string;
}

export interface Guards {
  /** Exige un jeton d'accès valide dont la session n'est ni révoquée ni expirée. */
  requireUser: (req: FastifyRequest) => Promise<AuthContext>;
  requireAdmin: (req: FastifyRequest) => Promise<AuthContext>;
  /** Écriture du référentiel : session administrateur, ou jeton de secours `ADMIN_TOKEN`. */
  authorizeRefWrite: (req: FastifyRequest) => Promise<void>;
}

export interface GuardOptions {
  db: Db | undefined;
  jwtSecret: string | undefined;
  adminToken: string | undefined;
  userRateLimitMax: number;
}

const WINDOW_MS = 60_000;

function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(given)), Buffer.from(hashToken(expected)));
}

export function createGuards(options: GuardOptions): Guards {
  const windows = new Map<string, { count: number; resetAt: number }>();

  /** Fenêtre fixe d'une minute par compte, en mémoire : le service tourne en une seule instance. */
  function throttle(userId: string): void {
    const now = Date.now();
    if (windows.size > 10_000) {
      for (const [id, w] of windows) if (w.resetAt <= now) windows.delete(id);
    }
    const current = windows.get(userId);
    if (current === undefined || current.resetAt <= now) {
      windows.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    current.count += 1;
    if (current.count > options.userRateLimitMax) {
      throw new HttpError(429, 'rate_limited', 'Trop de requêtes, réessaie un peu plus tard.');
    }
  }

  const requireUser = async (req: FastifyRequest): Promise<AuthContext> => {
    if (options.db === undefined || options.jwtSecret === undefined) {
      throw new HttpError(503, 'auth_unavailable', 'Les comptes ne sont pas configurés.');
    }
    const claims = await verifyAccessToken(options.jwtSecret, bearer(req));
    const user =
      claims === undefined
        ? undefined
        : await findActiveSession(options.db, claims.userId, claims.sessionId);
    if (claims === undefined || user === undefined) {
      throw new HttpError(401, 'unauthorized', 'Connexion requise ou expirée.');
    }
    throttle(user.id);
    return { user, sessionId: claims.sessionId };
  };

  const requireAdmin = async (req: FastifyRequest): Promise<AuthContext> => {
    const context = await requireUser(req);
    if (context.user.role !== 'admin') {
      throw new HttpError(403, 'forbidden', 'Réservé aux administrateurs.');
    }
    return context;
  };

  const authorizeRefWrite = async (req: FastifyRequest): Promise<void> => {
    const hasSessions = options.jwtSecret !== undefined;
    if (options.adminToken === undefined && !hasSessions) {
      throw new HttpError(403, 'forbidden', "L'écriture du référentiel est désactivée.");
    }
    if (options.adminToken !== undefined && sameSecret(bearer(req), options.adminToken)) return;
    if (!hasSessions) {
      throw new HttpError(401, 'unauthorized', 'Jeton administrateur manquant ou invalide.');
    }
    await requireAdmin(req);
  };

  return { requireUser, requireAdmin, authorizeRefWrite };
}
