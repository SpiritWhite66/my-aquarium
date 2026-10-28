import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { applyMigrations } from './db/apply-migrations.js';

const config = loadConfig(process.env);
// Offre gratuite de Render : pas de commande de pré-déploiement, les migrations se jouent au démarrage.
if (config.RUN_MIGRATIONS && config.DATABASE_URL !== undefined) {
  await applyMigrations(config.DATABASE_URL);
}
const app = await buildApp(config);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
