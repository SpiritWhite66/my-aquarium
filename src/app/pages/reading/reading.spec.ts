import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

let app: App;
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});
const field = (id: string) => app.el().querySelector<HTMLInputElement>('#' + id)!;
const set = (id: string, value: string) => app.type(field(id), value);
const save = () => app.press('header button.fill', 'Enregistrer');
const pills = () => [...app.el().querySelectorAll('.checks .pill')].map((p) => p.textContent!.trim());
const waterTests = async (tankId: string) => (await app.db.waterTests.where('tankId').equals(tankId).toArray()).filter((t) => t.id.length > 3);

describe('nouveau relevé', () => {
  it('propose le bac de l’adresse, sinon le premier, et change de bac', async () => {
    app = await bootApp();
    await app.go('/releve?bac=b', 'Nouveau relevé');
    const select = () => app.el().querySelector('select') as HTMLSelectElement;
    await app.until(() => select().value === 'b');
    expect(select().selectedOptions[0].textContent).toContain('Nano');
    app.type(select(), 'a');
    expect(select().value).toBe('a');
    await app.go('/releve?bac=inconnu', 'Nouveau relevé');
    await app.until(() => select().value !== '');
    expect(select().selectedOptions[0].textContent).toContain('Bac salon');
  });

  it('ne peut pas être enregistré tant que rien n’est saisi', async () => {
    app = await bootApp();
    await app.go('/releve?bac=a', 'Nouveau relevé');
    expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(true);
    set('p-ph', '   ');
    expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(true);
    set('p-ph', 'abc');
    expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(true);
    set('p-ph', '7,2');
    expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(false);
  });

  it('rappelle les valeurs du relevé précédent', async () => {
    app = await bootApp();
    await app.go('/releve?bac=a', 'valeur du relevé précédent');
    expect(app.find('p.sub')?.textContent).toMatch(/valeur du relevé précédent \(.*\)/);
    expect(app.find('label[for=p-ph] .prev')?.textContent).toBe('6,3');
    expect(field('p-ph').placeholder).toBe('6,3');
  });

  it('sans relevé précédent, rien n’est rappelé', async () => {
    app = await bootApp();
    await app.go('/releve?bac=b', 'Nouveau relevé');
    await app.until(() => (app.el().querySelector('select') as HTMLSelectElement).value === 'b');
    expect(app.find('.prev')).toBeNull();
    expect(field('p-ph').placeholder).toBe('');
    expect(app.find('p.sub', 'valeur du relevé précédent')).toBeNull();
  });

  it('juge chaque valeur saisie par rapport à la plage du bac', async () => {
    app = await bootApp();
    await app.go('/releve?bac=a', 'Nouveau relevé');
    set('p-ph', '7');
    set('p-no3', '60');
    set('p-temp', '15');
    expect(pills()).toEqual(['pH 7 · dans la plage 6,5–7,5', 'NO3 60 · hors plage 5–25', 'Temp. 15 · hors plage 20–26']);
    expect(app.find('.field.danger')).not.toBeNull();
    expect(app.find('.checks .pill.ok')?.textContent).toContain('pH 7');
    expect(app.find('.checks .pill.dg')?.textContent).toContain('NO3');
    expect(app.find('.checks')?.getAttribute('aria-live')).toBe('polite');
    set('p-no3', '');
    expect(pills()).toHaveLength(2);
  });

  it('une valeur légèrement hors plage est une alerte, pas un danger', async () => {
    app = await bootApp();
    await app.go('/releve?bac=a', 'Nouveau relevé');
    set('p-ph', '7,6');
    expect(app.find('.field.warn')).not.toBeNull();
    expect(app.find('.field.danger')).toBeNull();
    expect(app.find('.checks .pill.wn')).not.toBeNull();
  });

  it('enregistre le relevé avec sa date, sa note et les virgules françaises', async () => {
    app = await bootApp();
    await app.go('/releve?bac=a', 'Nouveau relevé');
    set('p-ph', '6,8');
    set('p-no3', '12');
    set('p-kh', '');
    set('note', '  après changement d’eau ');
    set('when', '2026-10-20T08:30');
    save();
    await vi.waitFor(async () => expect((await app.db.waterTests.toArray()).some((t) => t.note === 'après changement d’eau')).toBe(true));
    const t = (await app.db.waterTests.toArray()).find((x) => x.note === 'après changement d’eau')!;
    expect(t.values).toEqual({ ph: 6.8, no3: 12 });
    expect(t.tankId).toBe('a');
    expect(t.date).toBe(new Date('2026-10-20T08:30').toISOString());
    expect(await app.db.observations.count()).toBe(1);
  });

  it('une note vide n’est pas enregistrée ; sans date, le relevé est daté de maintenant', async () => {
    app = await bootApp();
    await app.go('/releve?bac=b', 'Nouveau relevé');
    await app.until(() => (app.el().querySelector('select') as HTMLSelectElement).value === 'b');
    set('p-ph', '7');
    set('note', '   ');
    set('when', '');
    save();
    await vi.waitFor(async () => expect((await app.db.waterTests.where('tankId').equals('b').toArray())).toHaveLength(1));
    const [t] = await app.db.waterTests.where('tankId').equals('b').toArray();
    expect(t.note).toBeUndefined();
    expect(Math.abs(Date.now() - new Date(t.date).getTime())).toBeLessThan(10_000);
  });

  it('valide la tâche « test de l’eau » due', async () => {
    app = await bootApp();
    await app.db.tasks.update('t2', { nextDue: '2000-01-01' });
    await app.go('/releve?bac=a', 'Nouveau relevé');
    set('p-ph', '7');
    save();
    await vi.waitFor(async () => expect((await app.db.tasks.get('t2'))!.nextDue > '2026-01-01').toBe(true));
  });

  describe('paramètres secondaires', () => {
    it('s’affichent à la demande', async () => {
      app = await bootApp();
      await app.go('/releve?bac=a', 'Nouveau relevé');
      expect(field('p-fe')).toBeNull();
      expect(app.find('button.out', 'Autres paramètres')?.textContent).toContain('Fe, K, Mg, Cond.');
      app.press('button.out', 'Autres paramètres');
      expect(field('p-fe')).not.toBeNull();
      expect(field('p-conductivity')).not.toBeNull();
      expect(app.find('button.out', 'Autres paramètres')).toBeNull();
    });

    it('s’affichent seuls quand un relevé précédent les a mesurés', async () => {
      app = await bootApp();
      await app.db.waterTests.update('w7', { values: { ph: 7, fe: 0.2 } });
      await app.go('/releve?bac=a', 'Nouveau relevé');
      await app.until(() => !!field('p-fe'));
      expect(app.find('button.out', 'Autres paramètres')?.textContent).toContain('K, Mg, Cond.');
      expect(app.find('button.out', 'Autres paramètres')?.textContent).not.toContain('Fe,');
    });
  });

  describe('algues', () => {
    it('une note d’algues seule suffit à enregistrer', async () => {
      app = await bootApp();
      await app.go('/releve?bac=a', 'Nouveau relevé');
      expect(app.find('.types')).toBeNull();
      app.press('.algae .lv button', 'Moyen');
      expect(app.find('.algae .lv button.on')?.textContent).toBe('Moyen');
      expect(app.find('.types')).not.toBeNull();
      expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(false);
      app.press('.types button', 'Filamenteuses');
      app.press('.types button', 'Eau verte');
      app.press('.types button', 'Eau verte');
      save();
      await vi.waitFor(async () => expect((await app.db.observations.toArray()).some((o) => o.manual && o.id !== 'o1')).toBe(true));
      const o = (await app.db.observations.toArray()).find((x) => x.manual && x.id !== 'o1')!;
      expect(o).toMatchObject({ tankId: 'a', algaeLevel: 2, algaeTypes: ['Filamenteuses'], overall: 'watch', summary: 'Algues : moyen (Filamenteuses)', findings: [] });
      expect(await waterTests('a')).toHaveLength(0);
    });

    it.each([[0, 'Aucune', 'good', 'Algues : aucune'], [3, 'Beaucoup', 'problem', 'Algues : beaucoup'], [1, 'Un peu', 'watch', 'Algues : un peu']])('niveau %i', async (level, label, overall, summary) => {
      app = await bootApp();
      await app.go('/releve?bac=a', 'Nouveau relevé');
      app.press('.algae .lv button', label);
      save();
      await vi.waitFor(async () => expect((await app.db.observations.toArray()).some((o) => o.manual && o.id !== 'o1')).toBe(true));
      const o = (await app.db.observations.toArray()).find((x) => x.manual && x.id !== 'o1')!;
      expect(o).toMatchObject({ algaeLevel: level, overall, summary });
      expect(o.algaeTypes).toBeUndefined();
    });

    it('un second clic retire la note', async () => {
      app = await bootApp();
      await app.go('/releve?bac=a', 'Nouveau relevé');
      app.press('.algae .lv button', 'Moyen');
      app.press('.algae .lv button', 'Moyen');
      expect(app.find('.algae .lv button.on')).toBeNull();
      expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(true);
    });

    it('accompagne un relevé d’eau avec la même date', async () => {
      app = await bootApp();
      await app.go('/releve?bac=a', 'Nouveau relevé');
      set('p-ph', '7');
      app.press('.algae .lv button', 'Un peu');
      set('when', '2026-10-21T09:00');
      save();
      await vi.waitFor(async () => expect((await app.db.observations.toArray()).some((o) => o.manual && o.id !== 'o1')).toBe(true));
      const o = (await app.db.observations.toArray()).find((x) => x.manual && x.id !== 'o1')!;
      expect(o.date).toBe(new Date('2026-10-21T09:00').toISOString());
    });
  });
});

describe('correction d’un relevé', () => {
  it('reprend les valeurs, sans la partie algues, et met le relevé à jour', async () => {
    app = await bootApp();
    await app.go('/releve?edit=w3&bac=a', 'Corriger le relevé');
    await app.until(() => field('p-ph').value !== '');
    expect(field('p-ph').value).toBe('6,7');
    expect(field('p-no3').value).toBe('25');
    expect(app.find('.algae')).toBeNull();
    set('p-no3', '30,5');
    set('note', 'corrigé');
    const before = await app.db.observations.count();
    save();
    await vi.waitFor(async () => expect((await app.db.waterTests.get('w3'))?.note).toBe('corrigé'));
    const t = (await app.db.waterTests.get('w3'))!;
    expect(t.values.no3).toBe(30.5);
    expect(t.values.ph).toBe(6.7);
    expect(await app.db.waterTests.count()).toBe(8);
    expect(await app.db.observations.count()).toBe(before);
  });

  it('un relevé sans valeur reste impossible à enregistrer', async () => {
    app = await bootApp();
    await app.go('/releve?edit=w3', 'Corriger le relevé');
    await app.until(() => field('p-ph').value !== '');
    for (const key of ['temp', 'ph', 'gh', 'kh', 'no2', 'no3', 'nh4', 'po4']) set('p-' + key, '');
    expect(app.find('header button.fill')!.hasAttribute('disabled')).toBe(true);
  });
});
