import { test, expect } from './fixtures';

const NEON = '/catalogue/paracheirodon-innesi';

test('crée un bac, le retrouve dans la liste puis après rechargement', async ({ app, page }) => {
  await page.goto('/bacs/nouveau');
  await page.getByLabel('Nom').fill('Bac du bureau');
  await page.getByLabel('Volume brut (L)').fill('54');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Bac du bureau', level: 1 })).toBeVisible();
  await page.reload();
  await expect(await app.tankLink('Bac du bureau')).toBeVisible();
});

test('ajoute des habitants, cumule la même espèce puis en déplace une partie', async ({
  app,
  page,
}) => {
  await app.seed();
  const add = async (qty: string) => {
    await page.goto(NEON);
    await page.getByLabel('Bac').selectOption({ label: 'Nano' });
    await page.getByLabel('Quantité').fill(qty);
    await page.getByRole('button', { name: 'Ajouter au bac' }).click();
    await expect(page).toHaveURL(/\/bacs\/nano\/population/);
  };
  await add('10');
  await add('5');
  const neon = page.getByRole('main').getByRole('link').filter({ hasText: 'Néon bleu' });
  await expect(neon).toHaveCount(1);
  await expect(neon).toContainText('15');

  await neon.click();
  await page.getByLabel('Bac', { exact: true }).selectOption({ label: 'Salon' });
  await page.getByLabel(/Quantité \(sur/).fill('4');
  await page.getByRole('button', { name: 'Déplacer' }).click();
  await expect(page.getByLabel('Quantité (sur 11)')).toBeVisible();
  await app.openTank('Nano');
  await expect(
    page.getByRole('main').getByRole('link').filter({ hasText: 'Néon bleu' }),
  ).toContainText('11');
  await app.openTank('Salon');
  await expect(
    page.getByRole('main').getByRole('link').filter({ hasText: 'Néon bleu' }),
  ).toContainText('16');
});

test('un relevé apparaît dans l’onglet Eau et valide la tâche « test de l’eau »', async ({
  app,
  page,
}) => {
  await app.seed();
  await page.goto('/bacs/nano/taches/nouvelle');
  await page.getByLabel('Type').selectOption({ label: 'Test de l’eau' });
  await page.getByLabel('Prochaine fois').fill('2020-01-01');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).not.toHaveURL(/taches/);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /Test de l’eau : marquer comme fait/ }),
  ).toBeVisible();

  await page.goto('/releve?bac=nano');
  await page.getByLabel('NO3 mg/L').fill('80');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).not.toHaveURL(/releve/);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /Test de l’eau : marquer comme fait/ }),
  ).toHaveCount(0);
  await app.openTank('Nano', 'eau');
  await expect(page.getByRole('main')).toContainText('80');
});

test('coche une tâche due : elle quitte l’accueil et entre dans l’historique', async ({
  app,
  page,
}) => {
  await app.seed();
  await page.goto('/bacs/salon/taches/nouvelle');
  await page.getByLabel('Type').selectOption({ label: 'Vitres' });
  await page.getByLabel('Libellé').fill('Nettoyer la vitre avant');
  await page.getByLabel('Prochaine fois').fill('2020-01-01');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).not.toHaveURL(/taches/);

  await page.goto('/');
  await page.getByRole('button', { name: 'Nettoyer la vitre avant : marquer comme fait' }).click();
  await expect(
    page.getByRole('button', { name: 'Nettoyer la vitre avant : marquer comme fait' }),
  ).toHaveCount(0);
  await app.openTank('Salon', 'entretien');
  await expect(page.getByRole('main')).toContainText('Nettoyer la vitre avant');
});

test('ajoute une photo, la met en couverture puis la supprime', async ({ app, page }) => {
  await app.seed();
  await app.openTank('Nano', 'photos');
  await page
    .locator('input[type=file][accept="image/*"]')
    .setInputFiles('public/apple-touch-icon.png');
  const thumbs = page.getByRole('main').locator('button.t');
  await expect(thumbs).toHaveCount(1);
  // La première photo d'un bac devient sa couverture.
  await expect(thumbs.first().getByTitle('Photo de couverture')).toBeVisible();
  await thumbs.first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Photo de couverture' }).click();
  await expect(dialog.getByRole('button', { name: 'Définir comme couverture' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Définir comme couverture' }).click();
  await expect(dialog.getByRole('button', { name: 'Photo de couverture' })).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer la photo' }).click();
  await expect(thumbs).toHaveCount(0);
});

test('modifie un réglage d’éclairage : le changement entre dans l’historique', async ({
  app,
  page,
}) => {
  await app.seed();
  await page.goto('/materiel/equipement/nouveau?bac=salon');
  await page.getByLabel('Nom').fill('Rampe LED');
  await page.getByLabel('Type').selectOption({ label: 'Éclairage' });
  await page.getByLabel('Intensité réglée (%)').fill('60');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).not.toHaveURL(/nouveau/);

  await page.goto('/materiel');
  await page
    .getByRole('link', { name: /Rampe LED/ })
    .first()
    .click();
  await page.getByLabel('Intensité réglée (%)').fill('80');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).toHaveURL(/\/materiel$/);

  await app.openTank('Salon', 'entretien');
  await expect(page.getByRole('main')).toContainText(/60\s*%\s*→\s*80\s*%/);
});

test('une fiche d’espèce utilisée ne peut pas être supprimée', async ({ app, page }) => {
  await app.seed();
  await page.goto('/catalogue/nouvelle');
  await page.getByLabel('Nom scientifique').fill('Betta imbellis');
  await page.getByLabel(/Noms communs/).fill('Combattant paisible');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).toHaveURL(/\/catalogue\/(?!nouvelle)[^/]+$/);
  const ficheUrl = page.url();

  await page.getByLabel('Bac').selectOption({ label: 'Nano' });
  await page.getByLabel('Quantité').fill('1');
  await page.getByRole('button', { name: 'Ajouter au bac' }).click();
  await expect(page).toHaveURL(/population/);

  await page.goto(`${ficheUrl}/modifier`);
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByRole('main')).toContainText('Cette fiche est utilisée par 1 habitant');
  await expect(page).toHaveURL(/modifier$/);
});

test('archive un bac puis le supprime', async ({ app, page }) => {
  await app.seed();
  await page.goto('/bacs/nano/modifier');
  await page.getByRole('button', { name: 'Archiver' }).click();
  await expect(page).toHaveURL(/\/bacs$/);
  await page.goto('/');
  await expect(page.getByRole('main').getByText('Nano', { exact: true })).toHaveCount(0);
  await page.goto('/bacs/nano/modifier');
  await expect(page.getByRole('button', { name: 'Désarchiver' })).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page).toHaveURL(/\/bacs$/);
  await page.goto('/reglages');
  await expect(page.getByRole('main')).not.toContainText('Nano');
});
