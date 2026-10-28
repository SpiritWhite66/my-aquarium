import { buildApp, mailerFor, pushSenderFor } from './app.js';
import { dispatch } from './push/repository.js';
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
  // Rappels push : un passage toutes les 15 minutes tant que le service est éveillé.
  const pushSender = pushSenderFor(config);
  const pushTimer =
    pushSender === undefined
      ? undefined
      : setInterval(
          () => {
            dispatch(connection.db, pushSender).then(
              (report) => {
                if (report.sent + report.removed + report.failed > 0)
                  app.log.info(report, 'rappels push');
              },
              (err: unknown) => {
                app.log.error({ err }, 'échec des rappels push');
              },
            );
          },
          15 * 60 * 1000,
        );
  pushTimer?.unref();
  app.addHook('onClose', async () => {
    clearInterval(pushTimer);
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
