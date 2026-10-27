import { readFile } from 'node:fs/promises';
import { test, expect, sampleBackup, JPEG_B64 } from './fixtures';

test.describe('sauvegarde et restauration', () => {
  test('exporte un ZIP, supprime tout, puis le restaure avec les photos', async ({ app, page }) => {
    await app.seed();
    await page.goto('/reglages');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.zip$/);
    // Chemin d'un fichier de téléchargement fourni par Playwright, pas d'une saisie externe.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- chemin issu de Playwright
    const zip = await readFile(await file.path());
    await expect(app.status()).toContainText('Sauvegarde téléchargée');

    // Suppression des deux bacs depuis leur fiche.
    for (const name of ['Salon', 'Nano']) {
      await page.goto('/reglages');
      // eslint-disable-next-line security/detect-non-literal-regexp -- `name` vient de la liste ci-dessus
      await page.getByRole('link', { name: new RegExp(`^${name} \\d+ L`) }).click();
      await page.getByRole('button', { name: 'Supprimer' }).click();
      await expect(page).not.toHaveURL(/modifier/);
    }
    await expect(await app.tankLink('Salon')).toHaveCount(0);

    await app.importFile({ name: 'sauvegarde.zip', mimeType: 'application/zip', buffer: zip });
    await expect(app.status()).toContainText('Données importées');
    await app.openTank('Salon');
    await expect(page.getByText('Néon', { exact: false }).first()).toBeVisible();
    await app.openTank('Salon', 'photos');
    await expect(page.getByRole('button', { name: /Vue de face/ })).toBeVisible();
  });

  test('les données restent après un rechargement', async ({ app, page }) => {
    await app.seed();
    await page.reload();
    await app.openTank('Nano');
    await expect(page.getByRole('heading', { name: 'Nano', level: 1 })).toBeVisible();
  });

  test('refuse une sauvegarde abîmée sans rien effacer', async ({ app }) => {
    await app.seed();
    const bad = {
      format: 'my-aquarium',
      version: 2,
      exportedAt: '',
      data: { tanks: [{ id: 'x', name: 3 }] },
    };
    await app.importFile({
      name: 'abimee.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bad)),
    });
    await expect(app.status()).toContainText('abîmée');
    await expect(await app.tankLink('Salon')).toBeVisible();
  });

  test('refuse un fichier qui n’est pas une sauvegarde', async ({ app }) => {
    await app.seed();
    await app.importFile({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(JPEG_B64, 'base64'),
    });
    await expect(app.status()).not.toContainText('Données importées');
    await expect(await app.tankLink('Salon')).toBeVisible();
  });

  test('écarte les lignes orphelines et le signale', async ({ app }) => {
    const data = sampleBackup();
    data.data.waterTests.push({ ...data.data.waterTests[0], id: 'w9', tankId: 'disparu' });
    await app.importFile({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await expect(app.status()).toContainText('relevés sans bac');
  });
});

test('reprend une base de l’ancienne version (v7, images dans la table des photos)', async ({
  app,
  page,
}) => {
  // Page vide sur la même origine, pour créer la base avant que l'appli ne l'ouvre.
  await page.route('**/vide', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>vide</title>' }),
  );
  await page.goto('/vide');
  await page.evaluate(async (b64) => {
    const stores: Record<string, string[]> = {
      tanks: ['archived'],
      species: ['kind', 'source', 'scientificName'],
      inhabitants: ['tankId', 'speciesId'],
      inhabitantEvents: ['inhabitantId', 'tankId', 'date'],
      waterTests: ['tankId', 'date'],
      tasks: ['tankId', 'nextDue'],
      logs: ['tankId', 'taskId', 'date'],
      observations: ['tankId', 'date'],
      photos: ['tankId', 'inhabitantId', 'date'],
      equipment: ['tankId', 'type'],
      consumables: ['category', 'expiryDate'],
      co2Readings: ['tankId', 'date'],
      diagnoses: ['tankId', 'date'],
      settingChanges: ['tankId', 'equipmentId', 'date'],
      prefs: [],
    };
    const jpeg = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
      type: 'image/jpeg',
    });
    const db = await new Promise<IDBDatabase>((ok, ko) => {
      const req = indexedDB.open('my-aquarium', 70); // Dexie : version 7 × 10
      req.onupgradeneeded = () => {
        for (const [name, idx] of Object.entries(stores)) {
          const s = req.result.createObjectStore(name, { keyPath: 'id' });
          idx.forEach((i) => s.createIndex(i, i));
        }
      };
      req.onsuccess = () => {
        ok(req.result);
      };
      req.onerror = () => {
        ko(req.error ?? new Error('Ouverture de la base impossible'));
      };
    });
    const tx = db.transaction(['tanks', 'photos'], 'readwrite');
    tx.objectStore('tanks').put({
      id: 'old',
      updatedAt: '',
      name: 'Ancien bac',
      type: 'planted',
      volumeGross: 60,
      startDate: '2025-01-01',
      co2: false,
      archived: false,
      coverPhotoId: 'a',
    });
    tx.objectStore('photos').put({
      id: 'a',
      updatedAt: '',
      tankId: 'old',
      date: '2025-06-01T10:00:00Z',
      width: 1,
      height: 1,
      caption: 'Avant migration',
      full: jpeg,
      thumb: jpeg,
    });
    await new Promise((ok) => (tx.oncomplete = ok));
    db.close();
  }, JPEG_B64);

  await app.openTank('Ancien bac', 'photos');
  await expect(page.getByRole('button', { name: /Avant migration/ })).toBeVisible();
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
});
