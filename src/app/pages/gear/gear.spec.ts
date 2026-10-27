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

describe('page matériel', () => {
  it('range les équipements par bac, avec ceux en réserve à part', async () => {
    app = await bootApp();
    await app.go('/materiel', 'Éclairage');
    const titles = [...app.el().querySelectorAll('section h2')].map((h) => h.textContent.trim());
    expect(titles).toEqual(['Bac salon 1', 'Nano 1', 'En réserve 1']);
    expect(app.find('a.li', 'Filtre de rechange')!.getAttribute('href')).toBe('/materiel/equipement/e3');
  });

  it('résume l’éclairage et indique la garantie', async () => {
    app = await bootApp(async (db) => {
      const { seedAll } = await import('../../testing/app.testing');
      await seedAll(db);
      await db.equipment.update('e3', { purchaseDate: '2020-01-01', warrantyMonths: 12, brand: 'Eheim', model: '2213' });
      await db.equipment.update('e2', { purchaseDate: new Date().toISOString().slice(0, 10), warrantyMonths: 24 });
    });
    await app.go('/materiel', 'Hors garantie');
    expect(app.find('a.li', 'Filtre de rechange')!.textContent).toContain('Eheim 2213');
    expect(app.find('a.li', 'CO2 nano')!.textContent).toContain('Garantie jusqu’au');
    expect(app.find('a.li', 'Éclairage')!.textContent).toMatch(/60 ?%/);
  });

  it('invite à noter un premier équipement quand il n’y en a pas', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/materiel', 'Note ton filtre');
    expect(app.find('a.fab')!.getAttribute('href')).toBe('/materiel/equipement/nouveau');
  });

  it('bascule vers les consommables, alerte quand le stock est bas et change le niveau', async () => {
    app = await bootApp();
    await app.go('/materiel?vue=consommables', 'Engrais');
    expect(app.find('.alert')?.textContent).toContain('Engrais');
    expect(app.find('.lv button.low')!.getAttribute('aria-pressed')).toBe('true');
    app.press('.lv button', 'Plein');
    await vi.waitFor(async () => expect((await app.db.consumables.get('c1'))?.level).toBe('full'));
    await vi.waitFor(() => {
      app.harness.detectChanges();
      expect(app.find('.alert')).toBeNull();
    });
  });

  it('invite à noter un premier consommable', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/materiel?vue=consommables', 'Indique le niveau');
    expect(app.find('a.fab')!.getAttribute('href')).toBe('/materiel/consommable/nouveau');
  });
});

describe('formulaire d’équipement', () => {
  it('ne peut pas être enregistré sans nom', async () => {
    app = await bootApp();
    await app.go('/materiel/equipement/nouveau', 'Nouvel équipement');
    expect(app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
    set('name', '   ');
    expect(app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
  });

  it('crée un éclairage avec ses réglages ; une plage horaire incomplète est ignorée', async () => {
    app = await bootApp();
    await app.go('/materiel/equipement/nouveau?bac=b', 'Nouvel équipement');
    expect(field('tank').value).toBe('b');
    set('name', ' Rampe LED ');
    set('type', 'light');
    app.press('.chipbtn', 'Blanc');
    app.press('.chipbtn', 'Bleu');
    app.press('.chipbtn', 'Blanc'); // décoché
    set('l-on', '10:00');
    set('l-off', '18:30');
    expect(app.el().textContent).toContain('8,5 h');
    set('s-on', '13:00'); // sieste incomplète
    set('l-int', '70');
    set('l-lev', '10');
    set('l-ramp', '30');
    set('l-par', '45');
    set('l-w', '36,5');
    set('l-lm', '3000');
    set('l-k', '6500');
    set('brand', 'Chihiros');
    set('price', '89,90');
    set('warranty', '24');
    set('bought', '2026-01-15');
    set('notes', 'Mat');
    set('specs', '120 cm');
    set('model', 'WRGB');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.equipment.toArray()).some((e) => e.name === 'Rampe LED')).toBe(true));
    const e = (await app.db.equipment.toArray()).find((x) => x.name === 'Rampe LED')!;
    expect(e).toMatchObject({ type: 'light', tankId: 'b', brand: 'Chihiros', model: 'WRGB', specs: '120 cm', price: 89.9, warrantyMonths: 24, purchaseDate: '2026-01-15', notes: 'Mat' });
    expect(e.light).toMatchObject({ channels: ['Bleu'], schedule: { on: '10:00', off: '18:30' }, intensityPct: 70, levels: 10, rampMinutes: 30, par: 45, powerW: 36.5, lumens: 3000, kelvin: 6500 });
    expect(e.light?.siesta).toBeUndefined();
    expect(e.filter).toBeUndefined();
  });

  it('crée un filtre, un chauffage et un CO2 avec leurs caractéristiques propres', async () => {
    app = await bootApp();
    await app.go('/materiel/equipement/nouveau', 'Nouvel équipement');
    set('name', 'Filtre');
    set('type', 'filter');
    set('f-flow', '900');
    set('f-media', 'Mousse');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.equipment.toArray()).some((e) => e.name === 'Filtre' && e.filter?.flowLh === 900 && e.filter.media === 'Mousse')).toBe(true));

    await app.go('/materiel/equipement/nouveau', 'Nouvel équipement');
    set('name', 'Chauffage');
    set('type', 'heater');
    set('h-w', '100');
    set('h-c', '25,5');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.equipment.toArray()).some((e) => e.name === 'Chauffage' && e.heater?.powerW === 100 && e.heater.setpointC === 25.5)).toBe(true));

    await app.go('/materiel/equipement/nouveau', 'Nouvel équipement');
    set('name', 'CO2');
    set('type', 'co2');
    set('c-l', '2');
    set('c-diff', 'Verre');
    set('c-on', '09:00');
    set('c-off', '17:00');
    app.click(app.find('label.check input'));
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.equipment.toArray()).some((e) => e.name === 'CO2' && e.co2?.cylinderL === 2 && e.co2.schedule?.off === '17:00' && e.co2.solenoid === true)).toBe(true));
  });

  it('modifie un équipement : le changement de réglage est proposé puis historisé', async () => {
    app = await bootApp();
    await app.go('/materiel/equipement/e1', 'Modifier l’équipement');
    await app.until(() => field('name').value === 'Éclairage');
    expect(field('l-int').value).toBe('60');
    expect(app.find('.changes')).toBeNull();
    set('l-int', '40');
    expect(app.find('.changes')?.textContent).toContain('40');
    set('ch-note', 'Algues vertes');
    set('ch-date', '2026-10-20');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect(await app.db.settingChanges.count()).toBe(1));
    const [c] = await app.db.settingChanges.toArray();
    expect(c).toMatchObject({ equipmentId: 'e1', field: 'light.intensityPct', note: 'Algues vertes' });
    expect((await app.db.equipment.get('e1'))?.light?.intensityPct).toBe(40);
  });

  it('supprime un équipement après confirmation', async () => {
    app = await bootApp();
    await app.go('/materiel/equipement/e3', 'Modifier l’équipement');
    await app.until(() => field('name').value === 'Filtre de rechange');
    vi.stubGlobal('confirm', () => false);
    app.press('button.danger', 'Supprimer');
    await app.flush();
    expect(await app.db.equipment.get('e3')).toBeDefined();
    vi.stubGlobal('confirm', () => true);
    app.press('button.danger', 'Supprimer');
    await vi.waitFor(async () => expect(await app.db.equipment.get('e3')).toBeUndefined());
  });
});

describe('formulaire de consommable', () => {
  it('crée un consommable avec ses dates et son prix', async () => {
    app = await bootApp();
    await app.go('/materiel/consommable/nouveau', 'Nouveau consommable');
    expect(app.find('button.fill', 'Enregistrer')!.hasAttribute('disabled')).toBe(true);
    set('name', ' Test NO3 ');
    set('cat', 'test_kit');
    set('lvl', 'half');
    set('brand', 'JBL');
    set('opened', '2026-09-01');
    set('exp', '2027-09-01');
    set('price', '12,5');
    set('notes', 'Ok');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.consumables.toArray()).some((c) => c.name === 'Test NO3')).toBe(true));
    expect((await app.db.consumables.toArray()).find((c) => c.name === 'Test NO3')).toMatchObject({ category: 'test_kit', level: 'half', brand: 'JBL', openedDate: '2026-09-01', expiryDate: '2027-09-01', price: 12.5, notes: 'Ok' });
  });

  it('modifie puis supprime un consommable', async () => {
    app = await bootApp();
    await app.go('/materiel/consommable/c1', 'Modifier');
    await app.until(() => field('name').value === 'Engrais');
    set('name', 'Engrais liquide');
    app.press('button.fill', 'Enregistrer');
    await vi.waitFor(async () => expect((await app.db.consumables.get('c1'))?.name).toBe('Engrais liquide'));
    await app.go('/materiel/consommable/c1', 'Modifier');
    await app.until(() => field('name').value === 'Engrais liquide');
    app.press('button.danger', 'Supprimer');
    await vi.waitFor(async () => expect(await app.db.consumables.get('c1')).toBeUndefined());
  });

  it('refuse de supprimer sans confirmation', async () => {
    app = await bootApp();
    await app.go('/materiel/consommable/c1', 'Modifier');
    await app.until(() => field('name').value === 'Engrais');
    vi.stubGlobal('confirm', () => false);
    app.press('button.danger', 'Supprimer');
    await app.flush();
    expect(await app.db.consumables.get('c1')).toBeDefined();
  });
});
