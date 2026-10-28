import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { CORS_ORIGIN: 'https://exemple.github.io' };

describe('loadConfig', () => {
  it('applique les valeurs par défaut', () => {
    expect(loadConfig(base)).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      APP_VERSION: 'dev',
      RATE_LIMIT_MAX: 100,
    });
  });

  it('convertit le port en nombre', () => {
    expect(loadConfig({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '70000', 'abc'])('refuse le port %s', (PORT) => {
    expect(() => loadConfig({ ...base, PORT })).toThrow(/PORT/);
  });

  it('exige CORS_ORIGIN', () => {
    expect(() => loadConfig({})).toThrow(/CORS_ORIGIN/);
  });

  it.each(['https://exemple.github.io/', 'https://exemple.github.io/app', 'pas une url'])(
    'refuse CORS_ORIGIN = %s (origine seule attendue)',
    (CORS_ORIGIN) => {
      expect(() => loadConfig({ CORS_ORIGIN })).toThrow(/CORS_ORIGIN/);
    },
  );

  it('exige DATABASE_URL en production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db' })
        .DATABASE_URL,
    ).toBe('postgres://u:p@h/db');
  });

  it('refuse une DATABASE_URL qui n’est pas PostgreSQL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });

  it('liste toutes les variables en cause', () => {
    expect(() => loadConfig({ PORT: 'x' })).toThrow(
      /CORS_ORIGIN[\s\S]*PORT|PORT[\s\S]*CORS_ORIGIN/,
    );
  });

  it('formate chaque erreur « variable : message »', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'Configuration invalide :\nDATABASE_URL : requise en production',
    );
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow(/^Configuration invalide :\nPORT : /);
  });

  it('ne migre pas au démarrage par défaut', () => {
    expect(loadConfig(base).RUN_MIGRATIONS).toBe(false);
    expect(loadConfig({ ...base, RUN_MIGRATIONS: 'true' }).RUN_MIGRATIONS).toBe(true);
    expect(() => loadConfig({ ...base, RUN_MIGRATIONS: 'oui' })).toThrow(/RUN_MIGRATIONS/);
  });

  describe('comptes', () => {
    it('sont désactivés par défaut', () => {
      expect(loadConfig(base)).toMatchObject({
        MAIL_TRANSPORT: 'none',
        ADMIN_EMAILS: [],
        USER_RATE_LIMIT_MAX: 300,
      });
      expect(loadConfig(base).JWT_SECRET).toBeUndefined();
    });

    it('exige un secret JWT d’au moins 32 caractères', () => {
      expect(() => loadConfig({ ...base, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
      expect(loadConfig({ ...base, JWT_SECRET: 'x'.repeat(32) }).JWT_SECRET).toHaveLength(32);
    });

    it('normalise la liste des administrateurs', () => {
      expect(loadConfig({ ...base, ADMIN_EMAILS: ' A@x.fr, ,b@x.fr ' }).ADMIN_EMAILS).toEqual([
        'a@x.fr',
        'b@x.fr',
      ]);
    });

    it('interdit le transport console en production', () => {
      const prod = {
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@h/db',
        MAIL_TRANSPORT: 'console',
      };
      expect(() => loadConfig(prod)).toThrow(/MAIL_TRANSPORT/);
      expect(loadConfig({ ...prod, MAIL_TRANSPORT: 'none' }).MAIL_TRANSPORT).toBe('none');
    });
  });
});
