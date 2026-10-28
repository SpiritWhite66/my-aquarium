import { buildApp, mailerFor } from './app.js';
import { startRetention } from './auth/retention.js';
import { loadConfig } from './config.js';
import { applyMigrations } from './db/apply-migrations.js';
import { createDb } from './db/client.js';

const config = loadConfig(process.env);
// Offre gratuite de Render : pas de commande de pré-déploiement, les migrations se jouent au démarrage.
if (config.RUN_MIGRATIONS && config.DATABASE_URL !== undefined) {
  await applyMigrations(config.DATABASE_URL);
}
const connection = config.DATABASE_URL === undefined ? undefined : createDb(config.DATABASE_URL);
const mailer = mailerFor(config);
const app = await buildApp(config, {
  ...(connection === undefined ? {} : { db: connection.db }),
  ...(mailer === undefined ? {} : { mailer }),
});
if (connection !== undefined) {
  const stop = startRetention({
    db: connection.db,
    mailer,
    log: (report) => {
      app.log.info(report, 'conservation des comptes');
    },
    onError: (err) => {
      app.log.error({ err }, 'échec de la conservation des comptes');
    },
  });
  app.addHook('onClose', async () => {
    stop();
    await connection.close();
  });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
