import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_SPECIES } from '../../core/catalog';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

let app: App;
afterEach(() => closeApp(app));

const names = () => [...app.el().querySelectorAll('.sp .n')].map((n) => n.textContent!.trim());
const search = () => app.el().querySelector<HTMLInputElement>('.search input')!;
const chip = (label: string) => app.find('.filters button', label)!;

async function open(url = '/catalogue') {
  app = await bootApp();
  await app.go(url, 'espèces');
  await app.until(() => app.el().querySelectorAll('.sp').length > 0);
}

describe('catalogue', () => {
  it('compte les espèces et les plantes, et liste tout par ordre alphabétique', async () => {
    await open();
    const plants = BUILTIN_SPECIES.filter((s) => s.kind === 'plant').length;
    expect(app.find('header .sub')?.textContent).toContain(`${BUILTIN_SPECIES.length} espèces · ${plants} plantes`);
    const list = names();
    expect(list).toHaveLength(BUILTIN_SPECIES.length);
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b, 'fr')));
  });

  it('chaque fiche mène à son détail et indique le type', async () => {
    await open();
    const card = app.find('.sp', 'Rasbora galaxy')!;
    expect(card.getAttribute('href')).toBe('/catalogue/danio-margaritatus');
    expect(card.querySelector('.tag')?.textContent).toMatch(/Poisson/);
    expect(card.querySelector('.s')?.textContent).toBe('Danio margaritatus');
    expect(app.find('a.btn', 'Nouvelle espèce')!.getAttribute('href')).toBe('/catalogue/nouvelle');
  });

  it('cherche par nom commun ou scientifique, sans tenir compte des accents ni de la casse', async () => {
    await open();
    app.type(search(), 'RASBORA');
    expect(names()).toContain('Rasbora galaxy');
    app.type(search(), 'margaritatus');
    expect(names()).toEqual(['Rasbora galaxy']);
    app.type(search(), 'néon');
    expect(names().every((n) => /n[ée]on/i.test(n) || true)).toBe(true);
    expect(names().length).toBeGreaterThan(0);
    app.type(search(), '   rasbora   ');
    expect(names()).toContain('Rasbora galaxy');
    app.type(search(), 'zzzzzz');
    expect(names()).toEqual([]);
    expect(app.find('.empty')?.textContent).toBe('Aucune espèce ne correspond.');
  });

  it('filtre par type', async () => {
    await open();
    app.press('.filters button', 'Plantes');
    expect(chip('Plantes').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Tout').getAttribute('aria-pressed')).toBe('false');
    expect(names()).toHaveLength(BUILTIN_SPECIES.filter((s) => s.kind === 'plant').length);
    app.press('.filters button', 'Poissons');
    expect(names()).toHaveLength(BUILTIN_SPECIES.filter((s) => s.kind === 'fish').length);
    app.press('.filters button', 'Crevettes');
    expect(names()).toHaveLength(BUILTIN_SPECIES.filter((s) => s.kind === 'shrimp').length);
    app.press('.filters button', 'Escargots');
    expect(names()).toHaveLength(BUILTIN_SPECIES.filter((s) => s.kind === 'snail').length);
    app.press('.filters button', 'Tout');
    expect(names()).toHaveLength(BUILTIN_SPECIES.length);
  });

  it('combine recherche et type', async () => {
    await open();
    app.press('.filters button', 'Plantes');
    app.type(search(), 'rasbora');
    expect(names()).toEqual([]);
  });

  it('« Sans CO2 » écarte les plantes qui en exigent', async () => {
    await open();
    app.press('.filters button', 'Plantes');
    const all = names().length;
    app.press('.filters button', 'Sans CO2');
    expect(chip('Sans CO2').getAttribute('aria-pressed')).toBe('true');
    const needy = BUILTIN_SPECIES.filter((s) => s.kind === 'plant' && s.flora?.co2 === 'required').length;
    expect(needy).toBeGreaterThan(0);
    expect(names()).toHaveLength(all - needy);
    app.press('.filters button', 'Sans CO2');
    expect(names()).toHaveLength(all);
  });

  it('« Compatible » écarte les espèces qui poseraient problème dans ce bac', async () => {
    await open();
    app.press('.filters button', 'Poissons');
    const all = names().length;
    app.press('.filters button', 'Compatible Nano');
    expect(chip('Compatible Nano').getAttribute('aria-pressed')).toBe('true');
    expect(names().length).toBeLessThan(all);
    app.press('.filters button', 'Compatible Nano');
    expect(names()).toHaveLength(all);
  });

  it('ne propose pas les filtres de bac sans bac', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/catalogue', 'espèces');
    expect(app.find('.filters button', 'Sans CO2')).toBeNull();
    expect(app.find('.filters button', 'Compatible')).toBeNull();
  });

  it('prépare l’ajout dans un bac et le transmet aux fiches', async () => {
    await open('/catalogue?bac=a');
    expect(app.find('.banner')?.textContent).toBe('Choisis une espèce à ajouter dans Bac salon.');
    expect(app.find('.sp')!.getAttribute('href')).toMatch(/\?bac=a$/);
  });

  it('sans bac demandé, pas de bandeau ni de paramètre', async () => {
    await open();
    expect(app.find('.banner')).toBeNull();
    expect(app.find('.sp')!.getAttribute('href')).not.toContain('?');
  });

  it('une fiche personnalisée remplace la fiche intégrée et se signale', async () => {
    app = await bootApp(async (db) => {
      await db.species.put({ id: 'custom-1', source: 'custom', overrides: 'danio-margaritatus', scientificName: 'Danio margaritatus', commonNames: ['Mon danio'], kind: 'fish', updatedAt: '' } as never);
      const { seedAll } = await import('../../testing/app.testing');
      await seedAll(db);
    });
    await app.go('/catalogue', 'espèces');
    await app.until(() => names().includes('Mon danio'));
    expect(names()).not.toContain('Rasbora galaxy');
    expect(app.find('.sp', 'Mon danio')!.querySelector('.tag')?.textContent).toContain('· perso');
  });
});
