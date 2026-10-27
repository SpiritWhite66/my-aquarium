import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, todayIso } from '../../core/dates';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

let app: App;
beforeEach(() => vi.stubGlobal('confirm', () => true));
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});
const field = (id: string) => app.el().querySelector<HTMLInputElement>('#' + id)!;
const set = (id: string, value: string) => app.type(field(id), value);
const save = () => app.press('button.fill', 'Enregistrer');
const canSave = () => !app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled');

describe('nouvelle tâche', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/bacs/a/taches/nouvelle', 'Nouvelle tâche');
  });

  it('nomme le bac et propose une tâche hebdomadaire dans sept jours', async () => {
    await app.until(() => app.find('p.sub')?.textContent === 'Bac salon');
    expect(field('every').value).toBe('7');
    expect(field('next').value).toBe(addDays(todayIso(), 7));
    expect(field('label').value).toBe('Changement d’eau');
    expect(app.find('button.danger')).toBeNull();
  });

  it('le libellé suit le type tant qu’il n’est pas personnalisé', () => {
    set('type', 'glass_clean');
    const first = field('label').value;
    expect(first).not.toBe('Changement d’eau');
    set('type', 'filter_clean');
    expect(field('label').value).not.toBe(first);
    set('label', 'Mon libellé');
    set('type', 'water_test');
    expect(field('label').value).toBe('Mon libellé');
  });

  it('exige un libellé, une fréquence d’au moins un jour et une date', () => {
    expect(canSave()).toBe(true);
    set('label', '   ');
    expect(canSave()).toBe(false);
    set('label', 'Ok');
    set('every', '0');
    expect(canSave()).toBe(false);
    set('every', 'abc');
    expect(canSave()).toBe(false);
    set('every', '1');
    expect(canSave()).toBe(true);
    set('next', '');
    expect(canSave()).toBe(false);
  });

  it('enregistre la tâche, fréquence arrondie', async () => {
    set('type', 'plant_trim');
    set('label', ' Tailler les tiges ');
    set('every', '10,6');
    set('next', '2026-11-05');
    save();
    await vi.waitFor(async () => expect((await app.db.tasks.toArray()).some((t) => t.label === 'Tailler les tiges')).toBe(true));
    const t = (await app.db.tasks.toArray()).find((x) => x.label === 'Tailler les tiges')!;
    expect(t).toMatchObject({ tankId: 'a', type: 'plant_trim', everyDays: 11, nextDue: '2026-11-05', active: true });
  });

  it('ne fait rien si le formulaire est invalide', async () => {
    set('every', '0');
    const before = await app.db.tasks.count();
    app.el().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await app.flush();
    expect(await app.db.tasks.count()).toBe(before);
  });
});

describe('modification d’une tâche', () => {
  it('reprend la tâche et la met à jour sur place', async () => {
    app = await bootApp();
    await app.go('/bacs/a/taches/t1', 'Modifier la tâche');
    await app.until(() => field('label').value === 'Changement d’eau');
    expect(field('every').value).toBe('7');
    expect(field('next').value).toBe('2026-10-20');
    set('every', '14');
    save();
    await vi.waitFor(async () => expect((await app.db.tasks.get('t1'))?.everyDays).toBe(14));
    expect(await app.db.tasks.count()).toBe(2);
  });

  it('supprime la tâche après confirmation', async () => {
    app = await bootApp();
    await app.go('/bacs/a/taches/t1', 'Modifier la tâche');
    await app.until(() => field('label').value === 'Changement d’eau');
    vi.stubGlobal('confirm', () => false);
    app.press('button.danger', 'Supprimer');
    await app.flush();
    expect(await app.db.tasks.get('t1')).toBeDefined();
    vi.stubGlobal('confirm', () => true);
    app.press('button.danger', 'Supprimer');
    await vi.waitFor(async () => expect(await app.db.tasks.get('t1')).toBeUndefined());
  });
});
