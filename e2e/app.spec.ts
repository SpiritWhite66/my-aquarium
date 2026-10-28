import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

test('le thème choisi est conservé après rechargement', async ({ page }) => {
  await page.goto('/reglages');
  const theme = page.getByRole('group', { name: 'Thème' });
  await theme.getByRole('button', { name: 'Sombre' }).click();
  await page.reload();
  await expect(theme.getByRole('button', { name: 'Sombre' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('un lien direct vers un onglet de bac fonctionne ; une adresse inconnue ramène à l’accueil', async ({
  app,
  page,
}) => {
  await app.seed();
  await page.goto('/bacs/salon/eau');
  await expect(page.getByRole('heading', { name: 'Salon', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eau' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/nimporte/quoi');
  await expect(page).toHaveURL(/\/$/);
});

test('crée un bac au clavier seulement', async ({ page }) => {
  await page.goto('/bacs/nouveau');
  await page.getByLabel('Nom').focus();
  await page.keyboard.type('Bac clavier');
  await page.getByLabel('Volume brut (L)').focus();
  await page.keyboard.type('40');
  // Le bouton se réactive après le rendu : Entrée n'envoie pas le formulaire tant qu'il est désactivé.
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Bac clavier', level: 1 })).toBeVisible();
});

test.describe('rappel de sauvegarde', () => {
  test('« Plus tard » le masque trois jours, puis il revient', async ({ app, page }) => {
    await page.clock.install({ time: new Date('2026-11-02T10:00:00') });
    await app.seed();
    await page.goto('/');
    const banner = page.getByText('Aucune sauvegarde pour l’instant');
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: 'Plus tard' }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(banner).toBeHidden();

    await page.clock.setFixedTime(new Date('2026-11-06T10:00:00'));
    await page.reload();
    await expect(banner).toBeVisible();
  });

  test('disparaît après une sauvegarde', async ({ app, page }) => {
    await app.seed();
    await page.goto('/');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Sauvegarder' }).click();
    await download;
    await expect(page.getByText('Aucune sauvegarde pour l’instant')).toBeHidden();
  });
});

const PAGES = [
  '/',
  '/bacs',
  '/bacs/salon/population',
  '/bacs/salon/eau',
  '/bacs/salon/entretien',
  '/bacs/salon/photos',
  '/releve',
  '/catalogue',
  '/catalogue/paracheirodon-innesi',
  '/materiel',
  '/reglages',
  '/diagnostic',
  '/import-ia',
  '/bacs/nouveau',
];

test.describe('accessibilité (axe)', () => {
  for (const url of PAGES) {
    test(`aucune violation grave sur ${url}`, async ({ app, page }) => {
      await app.seed();
      await page.goto(url);
      await page.getByRole('main').waitFor();
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        serious.map(
          (v) =>
            `${v.id} (${String(v.nodes.length)}) : ${v.help} — ${v.nodes[0]?.target.join(' ') ?? ''}`,
        ),
      ).toEqual([]);
    });
  }
});

test('le catalogue en ligne est désactivé par défaut : l’appli utilise son catalogue intégré', async ({
  app,
  page,
}) => {
  await app.seed();
  await page.goto('/reglages');
  const toggle = page.getByRole('switch', { name: 'Utiliser le catalogue en ligne' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Catalogue en ligne (bêta)')).toBeVisible();
  // L'API est configurée mais le réglage reste désactivé : rien n'est demandé au réseau.
  await expect(toggle).toBeEnabled();
  await page.goto('/catalogue');
  await expect(page.getByText('Danio margaritatus').first()).toBeVisible();
});

test('les comptes sont ouverts mais facultatifs : la connexion se propose sans rien imposer', async ({
  app,
  page,
}) => {
  await app.seed();
  await page.goto('/reglages');
  await expect(page.getByRole('heading', { name: 'Compte' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Se connecter/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Confidentialité' })).toBeVisible();
  // L'appli reste utilisable sans compte.
  await page.goto('/catalogue');
  await expect(page.getByText('Danio margaritatus').first()).toBeVisible();
  await page.goto('/connexion');
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
  await page.goto('/confidentialite');
  await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible();
});
