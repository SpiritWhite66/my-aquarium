import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/** Connexion paresseuse : aucune connexion n'est ouverte avant la première requête SQL. */
export function createDb(url: string) {
  const sql = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 15 });
  return { db: drizzle(sql), close: () => sql.end() };
}
