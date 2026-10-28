import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/db/client.js';
import { applyMigrations } from '../src/db/apply-migrations.js';
import { migrationsFolder } from '../src/db/folder.js';

const url = process.env['TEST_DATABASE_URL'];
const folder = migrationsFolder;

describe('migrations', () => {
  it('ont un fichier SQL par entrée du journal', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dossier de migrations fixe du dépôt
    const files = readdirSync(folder);
    expect(files.filter((f) => f.endsWith('.sql'))).toContain('0000_schemas_et_referentiel.sql');
  });

  // Exécuté en CI (service PostgreSQL) ; en local : TEST_DATABASE_URL=postgres://…
  it.skipIf(url === undefined)(
    'créent les schémas et tables du référentiel, et sont rejouables',
    async () => {
      const { db, close } = createDb(url ?? '');
      try {
        await migrate(db, { migrationsFolder: folder });
        await applyMigrations(url ?? '');
        const rows = await db.execute<{ schema_name: string }>(
          sql`select schema_name from information_schema.schemata where schema_name in ('ref','aqua','auth') order by 1`,
        );
        expect(rows.map((r) => r.schema_name)).toEqual(['aqua', 'auth', 'ref']);
        const tables = await db.execute<{ table_name: string }>(
          sql`select table_name from information_schema.tables where table_schema = 'ref' order by 1`,
        );
        expect(tables.map((t) => t.table_name)).toEqual(['consumable', 'equipment', 'species']);
        const authTables = await db.execute<{ table_name: string }>(
          sql`select table_name from information_schema.tables where table_schema = 'auth' order by 1`,
        );
        expect(authTables.map((t) => t.table_name)).toEqual([
          'login_tokens',
          'sessions',
          'user_consents',
          'users',
        ]);
      } finally {
        await close();
      }
    },
  );
});
