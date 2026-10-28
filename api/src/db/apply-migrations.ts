import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';
import { migrationsFolder } from './folder.js';

/** Applique les migrations en attente (rejouable) puis referme la connexion. */
export async function applyMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
