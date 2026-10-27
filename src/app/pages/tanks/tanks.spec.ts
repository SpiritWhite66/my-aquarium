import { afterEach, describe, expect, it } from 'vitest';
import { bootApp, closeApp, seedAll, type App } from '../../testing/app.testing';

let app: App;
afterEach(() => closeApp(app));

describe('liste des bacs', () => {
  it('montre une carte par bac actif et les bacs archivés à part', async () => {
    app = await bootApp(async (db) => {
      await seedAll(db);
      await db.tanks.put({ id: 'z', updatedAt: '', name: 'Vieux bac', type: 'planted', volumeGross: 20, startDate: '2025-01-01', co2: false, archived: true });
    });
    await app.go('/bacs', 'Archivés');
    expect(app.el().querySelectorAll('app-tank-card')).toHaveLength(2);
    expect(app.find('h2', 'Archivés')).not.toBeNull();
    const archived = app.find('.archived a.li')!;
    expect(archived.textContent).toContain('Vieux bac');
    expect(archived.getAttribute('href')).toBe('/bacs/z/modifier');
    expect(app.find('.card.empty')).toBeNull();
    expect(app.find('a.btn', 'Nouveau bac')!.getAttribute('href')).toBe('/bacs/nouveau');
  });

  it('invite à créer un premier bac, sans section archivés', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/bacs', 'Aucun bac pour l’instant.');
    expect(app.find('h2', 'Archivés')).toBeNull();
  });
});
