import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

const env = (kind: string, data: unknown) => ({ format: 'my-aquarium-ai', version: 1, kind, data });
const fenced = (...p: unknown[]) => p.map((x) => '```json\n' + JSON.stringify(x) + '\n```').join('\n');

test('le dossier de diagnostic contient les relevés du bac', async ({ app, page }) => {
  await app.seed();
  await page.goto('/diagnostic?bac=salon');
  await page.getByLabel('Quel est le problème ?').fill('Algues vertes sur les vitres');
  const first = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger' }).click();
  const file = await first;
  expect(file.suggestedFilename()).toMatch(/^dossier-salon-.*\.json$/);
  const dossier = await readFile(await file.path(), 'utf8');
  expect(dossier).toContain('Algues vertes sur les vitres');
  expect(dossier).toContain('"no3": 20');
});

test('importe une réponse de diagnostic : plan d’action et tâche créés', async ({ app, page }) => {
  await app.seed();
  await page.goto('/import-ia?bac=salon');
  const diagnosis = env('diagnosis', {
    summary: 'Trop de lumière',
    hypotheses: [{ title: 'Excès de lumière', probability: 'high', evidence: ['NO3 élevé'] }],
    actions: [{ title: 'Réduire la photopériode', priority: 'now', task: { type: 'custom', label: 'Réduire la photopériode' } }],
    followUp: { inDays: 7, measure: ['NO3'] },
  });
  await page.getByLabel('Réponse de l’IA').fill(fenced(diagnosis));
  await page.getByRole('button', { name: 'Analyser' }).click();
  await expect(page.getByRole('main')).toContainText('Excès de lumière');
  await page.getByRole('button', { name: /^Importer \(/ }).click();
  await expect(page).toHaveURL(/\/bacs\/salon\//);

  await app.openTank('Salon');
  await expect(page.getByRole('main')).toContainText('Trop de lumière');
  await app.openTank('Salon', 'entretien');
  await expect(page.getByRole('main')).toContainText('Réduire la photopériode');
});

test('importe un inventaire : espèce connue reconnue', async ({ app, page }) => {
  await app.seed();
  await page.goto('/import-ia?bac=nano');
  const inventory = env('inventory', { items: [{ scientificName: 'Danio margaritatus', kind: 'fish', quantity: 8, unit: 'individual', confidence: 'high' }] });
  await page.getByLabel('Réponse de l’IA').fill(fenced(inventory));
  await page.getByRole('button', { name: 'Analyser' }).click();
  await page.getByRole('button', { name: /^Importer \(1\)/ }).click();
  await expect(page).toHaveURL(/\/bacs\/nano\//);
  await app.openTank('Nano');
  await expect(page.getByRole('main').getByRole('link').filter({ hasText: 'Danio margaritatus' })).toContainText('8');
});

test('une réponse illisible est expliquée et rien n’est enregistré', async ({ app, page }) => {
  await app.seed();
  await page.goto('/import-ia?bac=nano');
  await page.getByLabel('Réponse de l’IA').fill('Je ne vois pas bien la photo, peux-tu en envoyer une autre ?');
  await page.getByRole('button', { name: 'Analyser' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Importer \(/ })).toHaveCount(0);
});
