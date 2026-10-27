import { fileURLToPath } from 'node:url';

/** Dossier des migrations SQL, identique depuis `src/` et `dist/`. */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
