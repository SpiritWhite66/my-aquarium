import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = await buildApp(config);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
