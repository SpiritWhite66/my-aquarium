// Génère, à partir des SKILL.md, du schéma et du catalogue :
//  - public/ai/my-aquarium-json.zip + prompt.md : analyse d'une photo (inventaire, tests, bilan visuel)
//  - public/ai/my-aquarium-diagnostic.zip + diagnostic-prompt.md : diagnostic d'un bac à partir de son dossier
// Chaque zip est un skill à importer dans Claude ; chaque prompt est le même contenu pour n'importe quelle IA.
// Lancé automatiquement avant `npm start` et `npm run build`.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const KINDS = { plant: 'Plantes', fish: 'Poissons', shrimp: 'Crevettes', snail: 'Escargots', other: 'Autres' };

// Catalogue : extrait de src/app/core/catalog.ts (kind, sci, names).
const catalogSrc = read('src/app/core/catalog.ts');
const entries = [...catalogSrc.matchAll(/kind: '(\w+)', sci: '([^']+)', names: \[([^\]]*)\]/g)].map((m) => ({
  kind: m[1],
  sci: m[2],
  names: [...m[3].matchAll(/'([^']+)'/g)].map((n) => n[1]),
}));
if (entries.length < 20) throw new Error(`Catalogue mal lu (${entries.length} espèces)`);

let catalogue = '# Espèces connues de l’application\n\nUtilise ces noms scientifiques tels quels quand l’espèce correspond.\n';
for (const [kind, label] of Object.entries(KINDS)) {
  const list = entries.filter((e) => e.kind === kind);
  if (!list.length) continue;
  catalogue += `\n## ${label}\n\n` + list.map((e) => `- ${e.sci} — ${e.names.join(', ')}`).join('\n') + '\n';
}

const schema = read('ai/my-aquarium-ai.schema.json');
const outDir = join(root, 'public/ai');
rmSync(join(root, 'ai/dist'), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/**
 * Un skill = un dossier zippé (SKILL.md + schema.json + catalogue.md) à importer dans Claude,
 * et le même contenu en un seul texte (prompt) pour n'importe quelle IA.
 */
function buildSkill(name, skillPath) {
  const skill = read(skillPath);
  const stage = join(root, 'ai/dist', name);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, 'SKILL.md'), skill);
  writeFileSync(join(stage, 'schema.json'), schema);
  writeFileSync(join(stage, 'catalogue.md'), catalogue);
  const zip = join(outDir, `${name}.zip`);
  rmSync(zip, { force: true });
  execFileSync('python3', ['-m', 'zipfile', '-c', zip, name], { cwd: join(root, 'ai/dist') });
  const body = skill.replace(/^---[\s\S]*?---\n/, '');
  return `${body}\n---\n\n${catalogue.replace(/^# /, '## ')}\n---\n\n## schema.json\n\n\`\`\`json\n${schema.trim()}\n\`\`\`\n`;
}

writeFileSync(join(outDir, 'prompt.md'), buildSkill('my-aquarium-json', 'ai/SKILL.md'));
writeFileSync(join(outDir, 'diagnostic-prompt.md'), buildSkill('my-aquarium-diagnostic', 'ai/diagnostic/SKILL.md'));

cpSync(join(root, 'ai/my-aquarium-ai.schema.json'), join(outDir, 'schema.json'));
console.log(`IA : skill et prompt générés (${entries.length} espèces).`);
