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
const save = () => app.press('button.fill', 'Enregistrer');
const canSave = () => !app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled');

describe('nouveau bac', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/bacs/nouveau', 'Nouveau bac');
  });

  it('exige un nom et un volume positif', () => {
    expect(canSave()).toBe(false);
    set('name', 'Mon bac');
    expect(canSave()).toBe(false);
    set('vg', '0');
    expect(canSave()).toBe(false);
    set('vg', 'abc');
    expect(canSave()).toBe(false);
    set('vg', '-5');
    expect(canSave()).toBe(false);
    set('vg', '54,5');
    expect(canSave()).toBe(true);
    set('name', '   ');
    expect(canSave()).toBe(false);
  });

  it('propose les tâches habituelles, pas d’archivage ni de suppression', () => {
    expect(checkbox('tâches d’entretien habituelles').checked).toBe(true);
    expect(app.find('button.out', 'Archiver')).toBeNull();
    expect(app.find('button.danger')).toBeNull();
    expect(field('start').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('crée le bac avec tous ses réglages et les tâches habituelles', async () => {
    set('name', ' Salon ');
    set('type', 'community');
    set('vg', '112,5');
    set('vn', '100');
    set('start', '2026-03-01');
    set('photo', '8,5');
    set('sub', ' Sable ');
    set('notes', ' Premier bac ');
    app.click(checkbox('Injection de CO2'));
    set('co2t', '60');
    app.click(checkbox('cyclage'));
    save();
    await vi.waitFor(async () =>
      expect((await app.db.tanks.toArray()).some((t) => t.name === 'Salon')).toBe(true),
    );
    const t = (await app.db.tanks.toArray()).find((x) => x.name === 'Salon')!;
    expect(t).toMatchObject({
      type: 'community',
      volumeGross: 112.5,
      volumeNet: 100,
      startDate: '2026-03-01',
      substrate: 'Sable',
      notes: 'Premier bac',
      co2: true,
      co2Target: 60,
      cycling: true,
      archived: false,
      lighting: { photoperiodHours: 8.5 },
    });
    expect((await app.db.tasks.where('tankId').equals(t.id).toArray()).length).toBeGreaterThan(3);
    await vi.waitFor(() => expect(app.harness.routeNativeElement?.textContent).toContain('Salon'));
  });

  it('les champs facultatifs vides ne sont pas enregistrés', async () => {
    set('name', 'Nu');
    set('vg', '20');
    app.click(checkbox('tâches d’entretien habituelles'));
    save();
    await vi.waitFor(async () =>
      expect((await app.db.tanks.toArray()).some((t) => t.name === 'Nu')).toBe(true),
    );
    const t = (await app.db.tanks.toArray()).find((x) => x.name === 'Nu')!;
    expect(t.volumeNet).toBeUndefined();
    expect(t.substrate).toBeUndefined();
    expect(t.notes).toBeUndefined();
    expect(t.cycling).toBeUndefined();
    expect(t.co2).toBe(false);
    expect(t.co2Target).toBeUndefined();
    expect(t.lighting).toBeUndefined();
    expect(await app.db.tasks.where('tankId').equals(t.id).count()).toBe(0);
  });

  it('le débit CO2 n’est retenu que si le bac a du CO2', async () => {
    expect(app.el().querySelector('#co2t')).toBeNull();
    app.click(checkbox('Injection de CO2'));
    set('co2t', '45');
    app.click(checkbox('Injection de CO2'));
    expect(app.el().querySelector('#co2t')).toBeNull();
    set('name', 'Sans CO2');
    set('vg', '20');
    save();
    await vi.waitFor(async () =>
      expect((await app.db.tanks.toArray()).some((t) => t.name === 'Sans CO2')).toBe(true),
    );
    expect(
      (await app.db.tanks.toArray()).find((t) => t.name === 'Sans CO2')!.co2Target,
    ).toBeUndefined();
  });

  it('ne fait rien si on valide un formulaire invalide', async () => {
    const before = await app.db.tanks.count();
    app
      .el()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await app.flush();
    expect(await app.db.tanks.count()).toBe(before);
  });
});

describe('modification d’un bac', () => {
  it('reprend les valeurs du bac et les met à jour sans le recréer', async () => {
    app = await bootApp();
    await app.go('/bacs/a/modifier', 'Modifier le bac');
    await app.until(() => field('name').value === 'Bac salon');
    expect(field('vg').value).toBe('60');
    expect(field('vn').value).toBe('50');
    expect(field('sub').value).toBe('Sable');
    expect(field('photo').value).toBe('8');
    expect(field('start').value).toBe('2026-03-01');
    expect(checkbox('Injection de CO2').checked).toBe(false);
    expect(app.find('label.check', 'tâches d’entretien habituelles')).toBeNull();
    set('name', 'Salon rénové');
    set('vn', '');
    save();
    await vi.waitFor(async () => expect((await app.db.tanks.get('a'))?.name).toBe('Salon rénové'));
    const t = (await app.db.tanks.get('a'))!;
    expect(t.volumeNet).toBeUndefined();
    expect(t.lighting).toEqual({ model: 'Rampe', photoperiodHours: 8 });
    expect(await app.db.tanks.count()).toBe(2);
    expect(await app.db.tasks.where('tankId').equals('a').count()).toBe(2);
  });

  it('reprend le CO2, son débit visé et le cyclage', async () => {
    app = await bootApp();
    await app.db.tanks.update('b', { cycling: true });
    await app.go('/bacs/b/modifier', 'Modifier le bac');
    await app.until(() => field('name').value === 'Nano');
    expect(checkbox('Injection de CO2').checked).toBe(true);
    expect(field('co2t').value).toBe('2');
    expect(checkbox('cyclage').checked).toBe(true);
    app.click(checkbox('cyclage'));
    save();
    await vi.waitFor(async () => expect((await app.db.tanks.get('b'))?.cycling).toBeUndefined());
  });

  it('écrit les décimales à la française', async () => {
    app = await bootApp();
    await app.db.tanks.update('a', { volumeGross: 112.5, volumeNet: 99.5 });
    await app.go('/bacs/a/modifier', 'Modifier le bac');
    await app.until(() => field('vg').value === '112,5');
    expect(field('vn').value).toBe('99,5');
  });

  it('archive puis désarchive', async () => {
    app = await bootApp();
    await app.go('/bacs/a/modifier', 'Modifier le bac');
    await app.until(() => field('name').value === 'Bac salon');
    app.press('button.out', 'Archiver');
    await vi.waitFor(async () => expect((await app.db.tanks.get('a'))?.archived).toBe(true));
    await app.go('/bacs/a/modifier', 'Modifier le bac');
    await app.until(() => !!app.find('button.out', 'Désarchiver'));
    app.press('button.out', 'Désarchiver');
    await vi.waitFor(async () => expect((await app.db.tanks.get('a'))?.archived).toBe(false));
  });

  it('supprime le bac et son historique après confirmation', async () => {
    app = await bootApp();
    await app.go('/bacs/a/modifier', 'Modifier le bac');
    await app.until(() => field('name').value === 'Bac salon');
    vi.stubGlobal('confirm', () => false);
    app.press('button.danger', 'Supprimer');
    await app.flush();
    expect(await app.db.tanks.get('a')).toBeDefined();
    const asked: string[] = [];
    vi.stubGlobal('confirm', (m: string) => (asked.push(m), true));
    app.press('button.danger', 'Supprimer');
    await vi.waitFor(async () => expect(await app.db.tanks.get('a')).toBeUndefined());
    expect(asked[0]).toBe(
      'Supprimer « Bac salon » et tout son historique ? Cette action est définitive.',
    );
    expect(await app.db.waterTests.where('tankId').equals('a').count()).toBe(0);
  });
});
