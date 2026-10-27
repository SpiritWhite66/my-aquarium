import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Le service worker d'Angular s'installe quand l'appli est stable (au plus tard après 30 s).
async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((ok) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => { ok(); }, { once: true });
      // Angular ne réclame pas les pages ouvertes : un rechargement suffit ensuite.
      if (reg.active) ok();
    });
  });
  // Le cache d'Angular se remplit en arrière-plan.
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.includes('ngsw')), undefined, { timeout: 45_000 });
}

test.describe('hors ligne', () => {
  test.setTimeout(90_000);

  test('l’appli s’ouvre sans réseau avec ses données, et enregistre un relevé', async ({ app, page, context }) => {
    await app.seed();
    await waitForServiceWorker(page);
    await page.reload();

    await context.setOffline(true);
    await page.goto('/bacs');
    await expect(await app.tankLink('Salon')).toBeVisible();

    await page.goto('/releve?bac=nano');
    await page.getByLabel('NO3 mg/L').fill('12');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page).not.toHaveURL(/releve/);
    await app.openTank('Nano', 'eau');
    await expect(page.getByRole('main')).toContainText('12');
  });
});

test('le manifeste rend l’appli installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href ?? '')).json()) as { start_url?: string; icons: { sizes: string; src: string }[] };
  expect(manifest).toMatchObject({ name: 'Mes aquariums', display: 'standalone' });
  expect(manifest.start_url).toBeTruthy();
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});
