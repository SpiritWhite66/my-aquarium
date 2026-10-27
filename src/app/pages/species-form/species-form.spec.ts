import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

let app: App;
beforeEach(() => vi.stubGlobal('confirm', () => true));
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});
const field = (id: string) => app.el().querySelector<HTMLInputElement>('#' + id)!;
const set = (id: string, value: string) => app.type(field(id), value);
const checkbox = (label: string) => app.find('label.check', label)!.querySelector('input')!;
const custom = async () => (await app.db.species.toArray()).filter((s) => s.source === 'custom');

describe('nouvelle fiche', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/catalogue/nouvelle', 'Nouvelle espèce');
  });

  it('ne s’enregistre pas sans nom scientifique', () => {
    expect(app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
    set('sci', '   ');
    expect(app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
    set('sci', 'Xenomystus nigri');
    expect(app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(false);
    expect(app.find('.info')).toBeNull();
  });

  it('crée une fiche d’animal complète, plages remises dans l’ordre et incomplètes ignorées', async () => {
    set('sci', ' Xenomystus nigri ');
    set('names', 'Poisson couteau, , Couteau africain ');
    set('diff', 'hard');
    set('temp-min', '28');
    set('temp-max', '24');
    set('ph-min', '6,5');
    set('gh-min', '5');
    set('gh-max', '');
    set('size', '20');
    set('group', '1');
    set('vol', '200');
    set('temper', 'semi-aggressive');
    set('zone', 'bottom');
    set('diet', 'carnivore');
    set('role', 'Prédateur');
    set('notes', ' Nocturne ');
    app.click(checkbox('Mange les plantes'));
    app.click(checkbox('jeunes crevettes'));
    app.click(checkbox('crevettes adultes'));
    app.click(checkbox('escargots'));
    app.click(checkbox('escargots')); // décoché
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect(await custom()).toHaveLength(1));
    const s = (await custom())[0];
    expect(s).toMatchObject({
      kind: 'fish', scientificName: 'Xenomystus nigri', commonNames: ['Poisson couteau', 'Couteau africain'], difficulty: 'hard', notes: 'Nocturne',
      temp: { min: 24, max: 28 }, ph: undefined, gh: undefined, kh: undefined,
      fauna: { adultSizeCm: 20, minGroup: 1, minTankLiters: 200, temperament: 'semi-aggressive', zone: 'bottom', diet: 'carnivore', role: 'Prédateur', eatsPlants: true, predation: ['shrimp_fry', 'shrimp'] },
    });
    expect(s.flora).toBeUndefined();
    expect(s.overrides).toBeUndefined();
    await vi.waitFor(() => expect(app.harness.routeNativeElement?.textContent).toContain('Xenomystus nigri'));
  });

  it('sans nom commun, le nom scientifique sert de nom', async () => {
    set('sci', 'Danio sp.');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await custom())[0]?.commonNames).toEqual(['Danio sp.']));
    expect((await custom())[0].difficulty).toBeUndefined();
    expect((await custom())[0].notes).toBeUndefined();
  });

  it('une plante montre ses réglages propres et enregistre une fiche de plante', async () => {
    set('kind', 'plant');
    expect(app.find('h2', 'Plante')).not.toBeNull();
    expect(app.find('h2', 'Animal')).toBeNull();
    set('sci', 'Bucephalandra sp.');
    set('light', 'low');
    set('co2', 'beneficial');
    set('growth', 'slow');
    set('place', 'background');
    set('form', 'rhizome');
    set('hmax', '12');
    app.type(field('prop'), 'division, bouture ,');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect(await custom()).toHaveLength(1));
    const s = (await custom())[0];
    expect(s.kind).toBe('plant');
    expect(s.flora).toMatchObject({ light: 'low', co2: 'beneficial', growth: 'slow', placement: 'background', form: 'rhizome', maxHeightCm: 12, propagation: ['division', 'bouture'] });
    expect(s.fauna).toBeUndefined();
  });

  it('un champ de forme ou de rôle vidé est retiré', async () => {
    set('kind', 'plant');
    set('form', 'tige');
    set('form', '');
    set('sci', 'Plante');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect(await custom()).toHaveLength(1));
    expect((await custom())[0].flora?.form).toBeUndefined();
  });
});

describe('fiche intégrée', () => {
  it('se personnalise en créant une copie à laquelle passent les habitants', async () => {
    app = await bootApp();
    await app.go('/catalogue/danio-margaritatus/modifier', 'Personnaliser la fiche');
    expect(app.find('.info')?.textContent).toContain('Fiche du catalogue intégré');
    await app.until(() => field('sci').value === 'Danio margaritatus');
    expect(field('names').value).toContain('Rasbora galaxy');
    expect(field('temp-min').value).toBe('20');
    expect(field('temp-max').value).toBe('26');
    expect(field('group').value).toBe('10');
    expect(app.find('button.danger')).toBeNull();
    set('group', '6');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect(await custom()).toHaveLength(1));
    const copy = (await custom())[0];
    expect(copy.overrides).toBe('danio-margaritatus');
    expect(copy.fauna?.minGroup).toBe(6);
    expect((await app.db.inhabitants.get('i1'))?.speciesId).toBe(copy.id);
    expect((await app.db.species.get('danio-margaritatus'))?.source).toBe('builtin');
  });
});

describe('fiche personnelle', () => {
  const seed = async () => {
    await app.db.species.put({ id: 'custom-x', source: 'custom', updatedAt: '', kind: 'fish', scientificName: 'Perso perso', commonNames: ['Perso'], ph: { min: 6, max: 7 }, fauna: { adultSizeCm: 3, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' } } as never);
  };

  it('se modifie sur place', async () => {
    app = await bootApp();
    await seed();
    await app.go('/catalogue/custom-x/modifier', 'Modifier la fiche');
    await app.until(() => field('sci').value === 'Perso perso');
    expect(field('ph-min').value).toBe('6');
    set('sci', 'Perso renommé');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.species.get('custom-x'))?.scientificName).toBe('Perso renommé'));
    expect((await custom()).filter((s) => s.id.startsWith('custom-')).map((s) => s.id)).toContain('custom-x');
  });

  it('se supprime après confirmation quand personne ne l’utilise', async () => {
    app = await bootApp();
    await seed();
    await app.go('/catalogue/custom-x/modifier', 'Modifier la fiche');
    await app.until(() => field('sci').value === 'Perso perso');
    vi.stubGlobal('confirm', () => false);
    app.press('button.danger', 'Supprimer');
    await app.flush();
    expect(await app.db.species.get('custom-x')).toBeDefined();
    vi.stubGlobal('confirm', () => true);
    app.press('button.danger', 'Supprimer');
    await vi.waitFor(async () => expect(await app.db.species.get('custom-x')).toBeUndefined());
  });

  it('refuse de supprimer une fiche utilisée, en comptant les habitants', async () => {
    app = await bootApp();
    await seed();
    await app.db.inhabitants.bulkPut([
      { id: 'u1', updatedAt: '', tankId: 'a', speciesId: 'custom-x', quantity: 1, unit: 'individual', addedDate: '2026-10-01', status: 'healthy' },
      { id: 'u2', updatedAt: '', tankId: 'b', speciesId: 'custom-x', quantity: 1, unit: 'individual', addedDate: '2026-10-01', status: 'healthy' },
    ]);
    await app.go('/catalogue/custom-x/modifier', 'Modifier la fiche');
    await app.until(() => field('sci').value === 'Perso perso');
    await vi.waitFor(() => {
      app.press('button.danger', 'Supprimer');
      expect(app.find('[role=alert]')?.textContent).toBe('Cette fiche est utilisée par 2 habitants : retire-les d’abord de tes bacs.');
    });
    expect(await app.db.species.get('custom-x')).toBeDefined();
  });

  it('accorde « habitant » au singulier', async () => {
    app = await bootApp();
    await seed();
    await app.db.inhabitants.put({ id: 'u1', updatedAt: '', tankId: 'a', speciesId: 'custom-x', quantity: 1, unit: 'individual', addedDate: '2026-10-01', status: 'healthy' });
    await app.go('/catalogue/custom-x/modifier', 'Modifier la fiche');
    await app.until(() => field('sci').value === 'Perso perso');
    await vi.waitFor(() => {
      app.press('button.danger', 'Supprimer');
      expect(app.find('[role=alert]')?.textContent).toContain('par 1 habitant :');
    });
  });
});
