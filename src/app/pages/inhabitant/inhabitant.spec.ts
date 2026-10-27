// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let app: App;
beforeEach(async () => {
  vi.stubGlobal('confirm', () => true);
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  app = await bootApp();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});

const field = (id: string) => app.el().querySelector<HTMLInputElement>('#' + id)!;
const change = (id: string, value: string) => {
  const el = field(id);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  app.harness.detectChanges();
};
const open = () => app.go('/bacs/a/habitants/i1', 'Rasbora galaxy');
const inh = async () => (await app.db.inhabitants.get('i1'))!;

describe('fiche d’un habitant', () => {
  it('présente l’espèce, la quantité et l’état', async () => {
    await open();
    expect(app.find('h1')?.textContent).toBe('Rasbora galaxy');
    expect(app.find('.sci')?.textContent).toContain('Danio margaritatus');
    expect(app.find('.sci a')!.getAttribute('href')).toBe('/catalogue/danio-margaritatus');
    expect(app.find('label[for=qty]')?.textContent).toContain('individus');
    expect(field('qty').value).toBe('12');
    expect((field('st') as unknown as HTMLSelectElement).selectedOptions[0].value).toBe('healthy');
  });

  it('ne montre rien pour un habitant inconnu', async () => {
    await app.go('/bacs/a/habitants/zzz');
    expect(app.el().querySelector('h1')).toBeNull();
  });

  it('corrige la quantité, sans jamais descendre sous zéro', async () => {
    await open();
    change('qty', '15');
    await vi.waitFor(async () => expect((await inh()).quantity).toBe(15));
    expect((await inh()).approximate).toBe(false);
    change('qty', '-4');
    await vi.waitFor(async () => expect((await inh()).quantity).toBe(0));
    change('qty', '7,6');
    await vi.waitFor(async () => expect((await inh()).quantity).toBe(8));
  });

  it('change l’état et l’emplacement', async () => {
    await open();
    change('st', 'sick');
    await vi.waitFor(async () => expect((await inh()).status).toBe('sick'));
    change('pl', 'Arrière gauche');
    await vi.waitFor(async () => expect((await inh()).placementNote).toBe('Arrière gauche'));
    change('pl', '');
    await vi.waitFor(async () => expect((await inh()).placementNote).toBeUndefined());
  });
});

describe('événements', () => {
  it('propose des événements d’animal et les inscrit avec la note saisie', async () => {
    await open();
    const labels = [...app.el().querySelectorAll('.ev button')].map((b) => b.textContent!.trim());
    expect(labels.length).toBeGreaterThan(2);
    app.type(field('note'), ' 2 morts ce matin ');
    const dead = app.find('.ev button', /Décès/)!;
    expect(dead.textContent).toContain('−1');
    app.click(dead);
    await vi.waitFor(async () => expect((await inh()).quantity).toBe(11));
    const ev = (await app.db.inhabitantEvents.toArray()).find((e) => e.type === 'death')!;
    expect(ev).toMatchObject({ quantityDelta: -1, note: '2 morts ce matin', inhabitantId: 'i1' });
    expect(field('note').value).toBe('');
    await vi.waitFor(() => expect(app.find('.log .li', 'Décès')).not.toBeNull());
    expect(app.find('.log .li', 'Décès')!.textContent).toContain('(-1)');
    expect(app.find('.log .li', 'Décès')!.textContent).toContain('2 morts ce matin');
  });

  it('une naissance ajoute un individu', async () => {
    await open();
    app.click(app.find('.ev button', /Naissance/));
    await vi.waitFor(async () => expect((await inh()).quantity).toBe(13));
  });

  it('un habitant végétal a ses propres événements', async () => {
    await app.db.inhabitants.put({ id: 'p1', updatedAt: '', tankId: 'a', speciesId: 'rotala-rotundifolia', quantity: 8, unit: 'stem', addedDate: '2026-09-01', status: 'healthy' });
    await app.go('/bacs/a/habitants/p1', 'Rotala');
    const labels = [...app.el().querySelectorAll('.ev button')].map((b) => b.textContent!.trim()).join(' | ');
    expect(labels).toMatch(/Taille|Bouture|Multipli/i);
    expect(labels).not.toMatch(/Naissance/);
  });

  it('dit quand le journal est vide', async () => {
    await app.db.inhabitantEvents.clear();
    await open();
    expect(app.find('.log')?.textContent).toContain('Aucun événement.');
  });
});

describe('déplacement', () => {
  it('propose les autres bacs et déplace tout après confirmation', async () => {
    await open();
    expect([...app.el().querySelectorAll('#to option')].map((o) => o.textContent)).toEqual(['Nano']);
    expect(field('mq').value).toBe('12');
    vi.stubGlobal('confirm', () => false);
    app.press('button.ton', 'Déplacer');
    await app.flush();
    expect((await inh()).tankId).toBe('a');
    vi.stubGlobal('confirm', () => true);
    app.press('button.ton', 'Déplacer');
    await vi.waitFor(async () => expect((await inh()).tankId).toBe('b'));
    await vi.waitFor(() => expect(app.harness.routeNativeElement?.textContent).toContain('Nano'));
  });

  it('déplace une partie seulement, bornée à la quantité présente', async () => {
    await open();
    app.type(field('mq'), '5');
    app.press('button.ton', 'Déplacer');
    await vi.waitFor(async () => expect((await inh()).quantity).toBe(7));
    expect((await app.db.inhabitants.where('tankId').equals('b').toArray()).some((i) => i.speciesId === 'danio-margaritatus' && i.quantity === 5)).toBe(true);
    expect((await inh()).tankId).toBe('a');
    expect(field('mq').value).toBe('7');
    app.type(field('mq'), '99');
    app.press('button.ton', 'Déplacer');
    await vi.waitFor(async () => expect((await inh()).tankId).toBe('b'));
  });

  it('ne propose rien quand il n’y a pas d’autre bac', async () => {
    await app.db.tanks.delete('b');
    await open();
    expect(app.find('h2', 'Déplacer vers un autre bac')).toBeNull();
  });
});

describe('photos de l’habitant', () => {
  async function withPhotos(count: number) {
    for (let n = 1; n <= count; n++) {
      await app.db.photos.put({ id: `ph${n}`, updatedAt: '', tankId: 'a', inhabitantId: 'i1', date: `2026-10-0${n}T10:00:00Z`, width: 10, height: 10 });
      await app.db.photoFiles.put({ id: `ph${n}`, full: new Blob(['f']), thumb: new Blob(['t']) });
    }
    await app.go('/bacs/a/habitants/i1', 'Rasbora galaxy');
    await app.until(() => app.el().querySelectorAll('.th').length === count);
  }

  it('compte et affiche les photos, ouvre la visionneuse', async () => {
    await withPhotos(2);
    expect(app.find('h2', 'Photos')?.textContent).toContain('2');
    app.click(app.find('.th'));
    expect(app.find('[role=dialog]')?.getAttribute('aria-label')).toBe('Photo');
  });

  it('ne propose de comparer qu’à partir de deux photos', async () => {
    await withPhotos(1);
    expect(app.find('button.out', 'Comparer')).toBeNull();
  });

  it('compare deux photos', async () => {
    await withPhotos(2);
    app.press('button.out', 'Comparer');
    expect(app.find('[role=dialog]')?.getAttribute('aria-label')).toBe('Comparaison avant et après');
    expect(app.find('.facts .chips')).toBeNull();
  });
});

describe('suppression', () => {
  it('supprime l’habitant et son journal après confirmation', async () => {
    await open();
    vi.stubGlobal('confirm', () => false);
    app.press('button.danger', 'Supprimer de l’inventaire');
    await app.flush();
    expect(await app.db.inhabitants.get('i1')).toBeDefined();
    vi.stubGlobal('confirm', () => true);
    app.press('button.danger', 'Supprimer de l’inventaire');
    await vi.waitFor(async () => expect(await app.db.inhabitants.get('i1')).toBeUndefined());
    expect(await app.db.inhabitantEvents.where('inhabitantId').equals('i1').count()).toBe(0);
  });
});
