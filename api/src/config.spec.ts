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
});
