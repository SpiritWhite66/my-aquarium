// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp, closeApp, type App } from '../testing/app.testing';

const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let app: App;
beforeEach(() => {
  vi.stubGlobal('confirm', () => true);
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});

const dialog = () => app.find('[role=dialog]');
const thumb = (label: RegExp) => [...app.el().querySelectorAll('.t')].find((t) => label.test(t.getAttribute('aria-label') ?? ''))!;
const input = (id: string) => app.el().querySelector<HTMLInputElement>('#' + id);

describe('compteur de bulles', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/bacs/b/eau', 'Compter les bulles');
    app.press('button', 'Compter les bulles');
  });

  it('s’ouvre dans une fenêtre nommée et se ferme avec Échap', async () => {
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('co2-title');
    expect(app.el().textContent).toContain('Compteur de bulles');
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    app.harness.detectChanges();
    expect(dialog()).toBeNull();
  });

  it('compte les bulles tapées et permet de recommencer', () => {
    expect(app.find('.btn.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
    for (let i = 0; i < 6; i++) app.click(app.find('.tap'));
    expect(app.find('.stats b')!.textContent).toBe('6');
    expect(app.find('.tap')!.textContent).toContain('6 comptées');
    app.press('button', 'Recommencer');
    expect(app.find('.stats b')!.textContent).toBe('0');
    expect(app.find('.tap')!.textContent).toContain('touche pour démarrer');
  });

  it('enregistre un débit saisi à la main et le retient comme cible', async () => {
    app.type(input('co2-manual'), '3');
    expect(app.el().textContent).toContain('Au-dessus de la cible (2 bulles/min)');
    app.press('button', 'Enregistrer comme cible');
    await app.until(() => dialog() === null);
    const r = (await app.db.co2Readings.toArray()).find((x) => x.bubblesPerMinute === 3)!;
    expect(r.tankId).toBe('b');
    expect((await app.db.tanks.get('b'))?.co2Target).toBe(3);
  });

  it('un débit dans la cible est annoncé, et le drop checker seul suffit pour enregistrer', async () => {
    app.type(input('co2-manual'), '2');
    expect(app.el().textContent).toContain('Dans la cible');
    app.type(input('co2-manual'), '');
    app.press('.dc button', 'Vert');
    expect(app.find('.dc button.on')!.getAttribute('aria-pressed')).toBe('true');
    app.press('.dc button', 'Vert'); // décoche
    expect(app.find('.dc button.on')).toBeNull();
    app.press('.dc button', 'Jaune');
    app.press('.btn.fill', 'Enregistrer');
    await app.until(() => dialog() === null);
    expect((await app.db.co2Readings.toArray()).some((r) => r.dropChecker === 'yellow' && r.bubblesPerMinute == null)).toBe(true);
  });

  it('compte au moins 5 bulles pour retenir un débit mesuré', async () => {
    for (let i = 0; i < 5; i++) app.click(app.find('.tap'));
    expect(app.find('.btn.ton', 'comme cible')).not.toBeNull();
    app.press('.btn.fill', 'Enregistrer');
    await app.until(() => dialog() === null);
    const mine = (await app.db.co2Readings.toArray()).find((r) => r.note?.includes('5 bulles'));
    expect(mine).toBeDefined();
  });
});

describe('pH sur la journée', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/bacs/b/eau', 'pH sur la journée');
    app.press('button', 'pH sur la journée');
  });

  it('calcule la baisse et le CO2 estimé, puis enregistre la mesure', async () => {
    expect(app.find('.btn.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
    app.type(input('ph-b'), '7,4');
    app.type(input('ph-a'), '6,6');
    expect(app.find('.res')!.textContent).toContain('Baisse de 0,8 point');
    app.type(input('ph-bt'), '09:00');
    app.type(input('ph-at'), '17:00');
    app.press('.btn.fill', 'Enregistrer');
    await app.until(() => dialog() === null);
    const r = (await app.db.co2Readings.toArray()).find((x) => x.phBefore === 7.4);
    expect(r).toMatchObject({ phAfter: 6.6, phBeforeTime: '09:00', phAfterTime: '17:00', tankId: 'b' });
  });

  it('ne propose rien tant que les deux pH ne sont pas saisis', () => {
    app.type(input('ph-b'), '7');
    expect(app.find('.res')).toBeNull();
  });

  it('se ferme par la croix', () => {
    app.press('button[aria-label=Fermer]');
    expect(dialog()).toBeNull();
  });
});

describe('changement d’eau', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/bacs/a/entretien', 'Changement d’eau');
  });

  it('estime les nitrates après le changement choisi et valide la tâche', async () => {
    app.press('button.done');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('wc-title');
    app.press('.pcts button', '50 %');
    expect(app.find('.pcts button.on')!.textContent).toContain('50');
    expect(input('wc-l')!.value).toBe('25');
    expect(app.find('.est')!.textContent).toContain('Nitrates');
    app.press('.btn.fill', 'C’est fait');
    await app.until(() => dialog() === null);
    const log = (await app.db.logs.toArray()).find((l) => l.taskId === 't1');
    expect(log?.details?.waterChangedLiters).toBe(25);
    expect(log?.note).toMatch(/^50 % \(25 L\) · NO3 estimé/);
    expect((await app.db.tasks.get('t1'))!.nextDue > '2026-10-20').toBe(true);
  });

  it('les litres saisis fixent le pourcentage, borné à 0–100', () => {
    app.press('button.done');
    app.type(input('wc-l'), '10');
    expect(input('wc-pct')!.value).toBe('20');
    app.type(input('wc-pct'), '250');
    expect(input('wc-pct')!.value).toBe('100');
    app.type(input('wc-pct'), 'abc');
    expect(input('wc-pct')!.value).toBe('0');
  });
});

describe('photos', () => {
  async function withPhotos() {
    app = await bootApp();
    for (const [id, day, inhabitantId] of [['p1', '2026-09-01', undefined], ['p2', '2026-10-01', undefined], ['p3', '2026-10-05', 'i1']] as const) {
      await app.db.photos.put({ id, updatedAt: '', tankId: 'a', inhabitantId, date: `${day}T10:00:00Z`, width: 300, height: 200 });
      await app.db.photoFiles.put({ id, full: new Blob(['f' + id], { type: 'image/jpeg' }), thumb: new Blob(['t' + id], { type: 'image/jpeg' }) });
    }
    await app.db.tanks.update('a', { coverPhotoId: 'p1' });
    await app.go('/bacs/a/photos', '3');
    await app.until(() => app.el().querySelectorAll('.t').length === 3);
  }

  it('affiche la grille avec la couverture marquée', async () => {
    await withPhotos();
    expect(app.el().querySelectorAll('.t .star')).toHaveLength(1);
    expect([...app.el().querySelectorAll('.t')].map((t) => t.getAttribute('aria-label')).filter((l) => l!.startsWith('Bac, '))).toHaveLength(2);
  });

  it('la visionneuse navigue (boutons et flèches) en boucle', async () => {
    await withPhotos();
    app.click(thumb(/^Bac, .*1 oct/));
    expect(dialog()?.getAttribute('aria-label')).toBe('Photo');
    const pos = () => app.find('.count')!.textContent!.trim();
    const start = Number(pos().split('/')[0]);
    app.press('button[aria-label="Photo suivante"]');
    expect(Number(pos().split('/')[0])).toBe((start % 3) + 1);
    app.press('button[aria-label="Photo précédente"]');
    expect(Number(pos().split('/')[0])).toBe(start);
    for (let i = 0; i < 3; i++) app.press('button[aria-label="Photo suivante"]');
    expect(Number(pos().split('/')[0])).toBe(start);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    app.harness.detectChanges();
    expect(Number(pos().split('/')[0])).toBe((start % 3) + 1);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    app.harness.detectChanges();
    expect(Number(pos().split('/')[0])).toBe(start);
  });

  it('la visionneuse change la couverture et la légende', async () => {
    await withPhotos();
    app.click(thumb(/^Bac, .*1 oct/));
    app.press('.btn.ton', 'Définir');
    await vi.waitFor(async () => expect((await app.db.tanks.get('a'))?.coverPhotoId).toBe('p2'));
    app.harness.detectChanges();
    expect(app.find('.btn.ton', 'couverture')!.textContent).toContain('Photo de couverture');
    const caption = input('caption')!;
    caption.value = 'Joli';
    caption.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await app.db.photos.get('p2'))?.caption).toBe('Joli'));
  });

  it('la visionneuse supprime une photo après confirmation et se ferme avec Échap', async () => {
    await withPhotos();
    app.click(thumb(/^Bac, .*1 sept/));
    app.press('button[aria-label="Supprimer la photo"]');
    await vi.waitFor(async () => expect(await app.db.photos.get('p1')).toBeUndefined());
    expect(await app.db.photoFiles.get('p1')).toBeUndefined();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    app.harness.detectChanges();
    expect(dialog()).toBeNull();
  });

  it('ne supprime rien si on refuse la confirmation', async () => {
    await withPhotos();
    vi.stubGlobal('confirm', () => false);
    app.click(thumb(/^Bac, .*1 sept/));
    app.press('button[aria-label="Supprimer la photo"]');
    await new Promise((r) => setTimeout(r, 30));
    expect(await app.db.photos.count()).toBe(3);
  });

  it('« Analyser avec l’IA » télécharge la photo quand le partage n’existe pas, puis ouvre l’import', async () => {
    await withPhotos();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    app.click(thumb(/^Bac, .*1 sept/));
    app.press('button[aria-label="Analyser avec l’IA"]');
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    await vi.waitFor(() => expect(app.harness.routeNativeElement?.textContent).toContain('Importer'));
    click.mockRestore();
  });

  it('compare deux photos en curseur puis côte à côte', async () => {
    await withPhotos();
    app.press('button', 'Comparer');
    expect(dialog()?.getAttribute('aria-label')).toBe('Comparaison avant et après');
    expect(app.find('.facts')!.textContent).toContain('entre les deux photos');
    expect(app.find('.cmp img')!.getAttribute('alt')).toMatch(/^Après, /);
    const range = app.find('input.range') as HTMLInputElement;
    app.type(range, '30');
    expect(range.getAttribute('aria-valuetext')).toBe('30 % de la photo avant');
    app.press('.seg button', 'Côte à côte');
    expect(app.el().querySelectorAll('.side figure')).toHaveLength(2);
    const sel = input('cmp-a')!;
    sel.value = 'p2';
    sel.dispatchEvent(new Event('change'));
    app.harness.detectChanges();
    app.press('button[aria-label=Fermer]');
    expect(dialog()).toBeNull();
  });

  it('ajouter une photo invalide affiche une erreur', async () => {
    await withPhotos();
    const file = app.el().querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(file, 'files', { value: [new File(['x'], 'a.txt', { type: 'text/plain' })], configurable: true });
    file.dispatchEvent(new Event('change'));
    await app.until(() => !!app.el().querySelector('.err'));
    expect(app.el().querySelector('.err')!.textContent).toContain('pas une image');
  });
});
