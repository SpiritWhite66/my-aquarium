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
            `${v.id} (${String(v.nodes.length)}) : ${v.help} — ${v.nodes[0]?.target.join(' ')}`,
        ),
      ).toEqual([]);
    });
  }
});
