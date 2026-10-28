import { afterEach, describe, expect, it } from 'vitest';
import { LEGAL } from '../../core/legal';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

let app: App;
afterEach(async () => {
  await closeApp(app);
});

describe('textes légaux', () => {
  it.each([
    ['/mentions-legales', 'Mentions légales', 'Hébergeurs'],
    ['/confidentialite', 'Politique de confidentialité', 'Tes droits'],
    ['/conditions', 'Conditions d’utilisation', 'Un outil d’aide, pas un conseil'],
  ])('%s s’affiche sans compte, avec sa version et sa date', async (url, title, section) => {
    app = await bootApp();
    await app.go(url, section);
    expect(app.find('h1')?.textContent).toBe(title);
    expect(app.el().textContent).toMatch(/Version \d+ · \d{4}-\d{2}-\d{2}/);
  });

  it('renvoie vers les deux autres textes', async () => {
    app = await bootApp();
    await app.go('/conditions', 'Contact');
    const links = [...app.el().querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/mentions-legales', '/confidentialite']);
  });

  it('donne l’adresse de contact en lien cliquable', async () => {
    app = await bootApp();
    await app.go('/mentions-legales', 'Hébergeurs');
    expect(app.find('a[href^="mailto:"]')?.textContent).toBe(LEGAL.contactEmail);
  });

  it('décrit ce qui est réellement enregistré, sans promettre ce qui n’existe pas', async () => {
    app = await bootApp();
    await app.go('/confidentialite', 'Tes droits');
    const text = app.el().textContent;
    expect(text).toContain('12 mois');
    expect(text).toContain('15 ans');
    expect(text).toContain('restent sur ton appareil');
  });
});
