// Exporte le catalogue embarqué de l'appli vers api/data/species.json (une seule fois, pour l'amorçage).
// Ensuite, la source de vérité est le serveur : le fichier ne sert qu'à (ré)amorcer une base vide.
// Node retire les types de catalog.ts (il n'importe que des types) : aucune compilation nécessaire.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SPECIES } from '../src/app/core/catalog.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const items = BUILTIN_SPECIES.map(({ updatedAt: _u, source: _s, overrides: _o, gbifKey: _g, wikidataId: _w, imageUrl: _i, ...fiche }) =>
  JSON.parse(JSON.stringify(fiche)),
);
writeFileSync(join(root, 'api/data/species.json'), JSON.stringify(items, null, 2) + '\n');
console.log(`${items.length} espèces exportées`);
