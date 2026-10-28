import { z } from 'zod';

function isOrigin(value: string): boolean {
  return URL.canParse(value) && new URL(value).origin === value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Origine autorisée par CORS : l'appli sur GitHub Pages (sans chemin). */
  CORS_ORIGIN: z.url().refine(isOrigin, 'origine seule, sans chemin ni « / » final'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /** Jeton de l'administrateur du référentiel (étape 2, avant les comptes). Absent : écriture désactivée. */
  ADMIN_TOKEN: z.string().min(32, 'au moins 32 caractères').optional(),
  /** Secret de signature des jetons d'accès (≥ 32 caractères). Absent : comptes désactivés. */
  JWT_SECRET: z.string().min(32, 'au moins 32 caractères').optional(),
  /** Adresses (séparées par des virgules) qui reçoivent le rôle administrateur à la connexion. */
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((list) =>
      list
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e !== ''),
    ),
  /** Page de l'appli qui reçoit le lien magique (`?token=…` y est ajouté). Défaut : `<CORS_ORIGIN>/connexion`. */
  LOGIN_URL: z.url().optional(),
  /** `console` écrit les e-mails sur la sortie standard (développement et tests de bout en bout seulement). */
  MAIL_TRANSPORT: z.enum(['none', 'console']).default('none'),
  /** Requêtes par minute et par compte connecté. */
  USER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  /** Applique les migrations au démarrage (déploiement en une seule instance). */
  RUN_MIGRATIONS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  APP_VERSION: z.string().min(1).default('dev'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
});

export type Config = z.infer<typeof envSchema>;

/** Lit et valide l'environnement ; échoue au démarrage avec la liste des variables en cause. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  if (result.data.NODE_ENV === 'production' && result.data.DATABASE_URL === undefined) {
    throw new Error('Configuration invalide :\nDATABASE_URL : requise en production');
  }
  if (result.data.NODE_ENV === 'production' && result.data.MAIL_TRANSPORT === 'console') {
    throw new Error(
      'Configuration invalide :\nMAIL_TRANSPORT : « console » interdit en production',
    );
  }
  return result.data;
}
