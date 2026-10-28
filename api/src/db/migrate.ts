import { loadConfig } from '../config.js';
import { applyMigrations } from './apply-migrations.js';

const url = loadConfig(process.env).DATABASE_URL;
if (url === undefined) {
  throw new Error('DATABASE_URL est requise pour migrer.');
}
await applyMigrations(url);
