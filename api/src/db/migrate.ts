import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { migrationsFolder } from './folder.js';

const url = loadConfig(process.env).DATABASE_URL;
if (url === undefined) {
  throw new Error('DATABASE_URL est requise pour migrer.');
}
const { db, close } = createDb(url);
await migrate(db, { migrationsFolder });
await close();
