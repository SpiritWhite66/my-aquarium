import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeService } from './core/theme';
import { bootShell } from './testing/app.testing';

let shell: Awaited<ReturnType<typeof bootShell>>;
afterEach(async () => {
  TestBed.resetTestingModule();
  await shell.db.delete();
});

const links = (el: HTMLElement, sel: string) =>
  [...el.querySelectorAll<HTMLAnchorElement>(sel)].map((a) => [
    a.textContent.trim(),
    a.getAttribute('href'),
  ]);
const NAV = [
  ['Accueil', '/'],
  ['Bacs', '/bacs'],
  ['Catalogue', '/catalogue'],
  ['Matériel', '/materiel'],
  ['Réglages', '/reglages'],
];

describe('coquille de l’appli', () => {
  it('propose la même navigation en barre latérale et en barre d’onglets, chacune nommée', async () => {
    shell = await bootShell();
    expect(links(shell.el, 'aside a.nav')).toEqual(NAV);
    expect(links(shell.el, 'nav.tabs a.tab')).toEqual(NAV);
    expect(shell.el.querySelector('aside')!.getAttribute('aria-label')).toBe('Navigation');
    expect(shell.el.querySelector('nav.tabs')!.getAttribute('aria-label')).toBe(
      'Navigation principale',
    );
  });

  it('marque l’entrée de la page courante, et l’accueil seulement à l’accueil', async () => {
    shell = await bootShell();
    const on = () =>
      [...shell.el.querySelectorAll('nav.tabs a.on')].map((a) => a.textContent.trim());
    expect(on()).toEqual(['Accueil']);
    await shell.router.navigateByUrl('/bacs/a/eau');
    await shell.settle();
    expect(on()).toEqual(['Bacs']);
    await shell.router.navigateByUrl('/catalogue/danio-margaritatus');
    await shell.settle();
    expect(on()).toEqual(['Catalogue']);
  });

  it('liste les bacs actifs avec leur état en texte', async () => {
    shell = await bootShell(async (db) => {
      const { seedAll } = await import('./testing/app.testing');
      await seedAll(db);
      await db.waterTests.put({
        id: 'bad',
        updatedAt: '',
        tankId: 'b',
        date: '2026-10-30T10:00:00Z',
        values: { no3: 99 },
      });
      await db.tanks.put({
        id: 'z',
        updatedAt: '',
        name: 'Archivé',
        type: 'planted',
        volumeGross: 20,
        startDate: '2025-01-01',
        co2: false,
        archived: true,
      });
    });
    await new Promise((r) => setTimeout(r, 100));
    await shell.settle();
    const tanks = [...shell.el.querySelectorAll('aside a.tk')].map((a) => [
      a.textContent.replace(/\s+/g, ' ').trim(),
      a.getAttribute('href'),
    ]);
    expect(tanks).toHaveLength(2);
    const nano = tanks.find((t) => t[0]!.includes('Nano'))!;
    expect(nano[1]).toBe('/bacs/b');
    expect(nano[0]).toContain('Nano · danger');
    expect(tanks.map((t) => t[1])).toEqual(['/bacs/a', '/bacs/b']);
    expect(tanks[0][0]).toMatch(/Bac salon · (tout va bien|à surveiller|danger)/);
    expect(shell.el.textContent).not.toContain('Archivé');
    expect(shell.el.querySelector('aside .dot')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('sans bac, n’affiche pas la liste des bacs', async () => {
    shell = await bootShell(false);
    expect(shell.el.querySelector('aside .sb')).toBeNull();
    expect(shell.el.querySelector('aside a.tk')).toBeNull();
  });

  it('démarre l’affichage du thème choisi', async () => {
    shell = await bootShell();
    expect(TestBed.inject(ThemeService)).toBeDefined();
  });

  describe('accessibilité', () => {
    it('propose un lien d’évitement vers le contenu, qui y place le focus', async () => {
      shell = await bootShell();
      const skip = shell.el.querySelector<HTMLAnchorElement>('a.skip')!;
      expect(skip.getAttribute('href')).toBe('#contenu');
      expect(skip.textContent.trim()).toBe('Aller au contenu');
      expect(
        shell.el
          .querySelector('a.skip')!
          .compareDocumentPosition(shell.el.querySelector('.shell')!),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      document.body.append(shell.el);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      skip.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement?.id).toBe('contenu');
      shell.el.remove();
    });

    it('le contenu est focalisable par programme mais pas par Tab', async () => {
      shell = await bootShell();
      const main = shell.el.querySelector('main')!;
      expect(main.id).toBe('contenu');
      expect(main.getAttribute('tabindex')).toBe('-1');
    });

    it('après un changement de page, le focus passe au contenu — pas au premier affichage', async () => {
      shell = await bootShell();
      document.body.append(shell.el);
      expect(document.activeElement?.id).not.toBe('contenu');
      await shell.router.navigateByUrl('/bacs');
      await shell.settle();
      expect(document.activeElement?.id).toBe('contenu');
      (document.activeElement as HTMLElement).blur();
      await shell.router.navigateByUrl('/catalogue');
      await shell.settle();
      expect(document.activeElement?.id).toBe('contenu');
      shell.el.remove();
    });
  });
});
