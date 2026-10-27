import { test as base, expect, type Page } from '@playwright/test';

// Chaque test part d'un navigateur neuf : base IndexedDB et localStorage vides.
export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    // Sans le sélecteur de fichier natif, l'export passe par un téléchargement que Playwright sait suivre.
    await page.addInitScript(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    // Les confirmations (« L'import remplace toutes les données… ») sont acceptées.
    page.on('dialog', (d) => d.accept());
    await use(new App(page));
  },
});
export { expect };

/** Une image JPEG de 1 × 1 pixel. */
export const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const jpegUrl = `data:image/jpeg;base64,${JPEG_B64}`;

const NOW = '2026-10-01T10:00:00.000Z';
const row = <T extends object>(id: string, r: T) => ({ id, updatedAt: NOW, ...r });

/** Une sauvegarde JSON (ancien format v1, toujours accepté) : deux bacs, des habitants, des relevés, une photo. */
export function sampleBackup() {
  return {
    format: 'my-aquarium',
    version: 1,
    exportedAt: NOW,
    data: {
      tanks: [
        row('salon', { name: 'Salon', type: 'planted', volumeGross: 120, startDate: '2026-01-01', co2: true, archived: false, coverPhotoId: 'p1' }),
        row('nano', { name: 'Nano', type: 'planted', volumeGross: 30, startDate: '2026-03-01', co2: false, archived: false }),
      ],
      species: [],
      inhabitants: [
        row('i1', { tankId: 'salon', speciesId: 'paracheirodon-innesi', quantity: 12, unit: 'individual', addedDate: '2026-02-01', status: 'healthy' }),
      ],
      inhabitantEvents: [],
      waterTests: [
        row('w1', { tankId: 'salon', date: '2026-09-20T18:00:00.000Z', values: { no3: 15, ph: 6.8 } }),
        row('w2', { tankId: 'salon', date: '2026-09-27T18:00:00.000Z', values: { no3: 20, ph: 6.9 } }),
      ],
      tasks: [],
      logs: [],
      photos: [row('p1', { tankId: 'salon', date: '2026-09-01T10:00:00.000Z', width: 1, height: 1, caption: 'Vue de face', full: jpegUrl, thumb: jpegUrl })],
    },
  };
}

export class App {
  constructor(readonly page: Page) {}

  /** Restaure une sauvegarde depuis les réglages, comme le ferait l'utilisateur. */
  async importFile(file: { name: string; mimeType: string; buffer: Buffer }) {
    await this.page.goto('/reglages');
    await this.page.locator('input[type=file]').setInputFiles(file);
  }

  async seed(data: object = sampleBackup()) {
    await this.importFile({ name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await expect(this.status()).toContainText('Données importées');
  }

  status() {
    return this.page.getByRole('status');
  }

  /** Lien vers un bac dans la liste des bacs (ouvre la liste). */
  async tankLink(name: string) {
    await this.page.goto('/bacs');
    return this.page.getByRole('main').getByRole('link').filter({ has: this.page.getByText(name, { exact: true }) }).first();
  }

  async openTank(name: string, tab = 'population') {
    await (await this.tankLink(name)).click();
    if (tab !== 'population') await this.page.getByRole('navigation', { name: 'Sections du bac' }).getByRole('link', { name: new RegExp(tab, 'i') }).click();
  }
}
