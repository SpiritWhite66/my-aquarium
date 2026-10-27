import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { importSpecies } from '../ref/import.js';
import { createDb } from './client.js';

// Usage : DATABASE_URL=… npm run import:ref -w api [fichier.json]
const url = loadConfig(process.env).DATABASE_URL;
if (url === undefined) {
  throw new Error('DATABASE_URL est requise pour importer.');
}
const file = process.argv[2] ?? fileURLToPath(new URL('../../data/species.json', import.meta.url));
const { db, close } = createDb(url);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fichier choisi par l'opérateur en ligne de commande
const content = await readFile(file, 'utf8');
try {
  const report = await importSpecies(db, JSON.parse(content));
  process.stdout.write(`Espèces : ${JSON.stringify(report)}\n`);
} finally {
  await close();
}
