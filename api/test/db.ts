import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type Db } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/folder.js';

/** Base de test : PostgreSQL réel (jamais simulé), migrée depuis zéro, tables du référentiel vidées. */
export const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

export async function openTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const connection = createDb(testDatabaseUrl ?? '');
  await migrate(connection.db, { migrationsFolder });
  return connection;
}

export async function clearRef(db: Db): Promise<void> {
  await db.execute(sql`truncate ref.species, ref.equipment, ref.consumable`);
}

export async function clearAuth(db: Db): Promise<void> {
  await db.execute(sql`truncate auth.users, auth.login_tokens, aqua.records cascade`);
}
