import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupService } from '../../core/backup';
import { addDays, todayIso } from '../../core/dates';
import { bootApp, closeApp, seedAll, type App } from '../../testing/app.testing';

let app: App;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});

const U = '';
const today = todayIso();
const task = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  updatedAt: U,
  tankId: 'a',
  type: 'custom' as const,
  label: id,
  everyDays: 7,
  nextDue: today,
  active: true,
  ...o,
});
const alerts = () =>
  [...app.el().querySelectorAll('.alert')].map((a) => a.textContent.replace(/\s+/g, ' ').trim());
const tasks = () =>
  [...app.el().querySelectorAll('.task')].map((a) => a.textContent.replace(/\s+/g, ' ').trim());

async function boot(seed: (db: App['db']) => PromiseLike<unknown> = async () => undefined) {
  app = await bootApp(async (db) => {
    await seedAll(db);
    await db.tasks.clear();
    await db.diagnoses.clear();
    await db.waterTests.clear();
    await db.observations.clear();
    await seed(db);
  });
}

describe('accueil', () => {
  it('affiche la date du jour et une carte par bac', async () => {
    await boot();
    await app.go('/', 'Mes bacs');
    expect(app.find('header .sub')?.textContent).toMatch(/^[A-ZÉ][a-zéû]+ \d{1,2} [a-zéû]+$/);
    expect(app.el().querySelectorAll('app-tank-card')).toHaveLength(2);
    expect(app.find('a.more', 'Tout voir')!.getAttribute('href')).toBe('/bacs');
  });

  it('invite à créer un premier bac quand il n’y en a pas, sans bouton de relevé', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/', 'Aucun bac pour l’instant.');
    expect(app.find('.empty a.fill')!.getAttribute('href')).toBe('/bacs/nouveau');
    expect(app.find('a.fab')).toBeNull();
    expect(app.find('a.desktop-only')).toBeNull();
  });

  it('le relevé mène au bac quand il n’y en a qu’un, sinon au choix', async () => {
    await boot();
    await app.go('/', 'Mes bacs');
    expect(app.find('a.fab')!.getAttribute('href')).toBe('/releve');
    await app.db.tanks.delete('b');
    await vi.waitFor(() => {
      app.harness.detectChanges();
      expect(app.find('a.fab')!.getAttribute('href')).toBe('/releve?bac=a');
    });
    expect(app.find('a.desktop-only')!.getAttribute('href')).toBe('/releve?bac=a');
  });
});

describe('rappel de sauvegarde', () => {
  it('apparaît sans sauvegarde, se repousse avec « Plus tard »', async () => {
    await boot();
    await app.go('/', 'Aucune sauvegarde pour l’instant');
    expect(app.find('.backup')?.getAttribute('role')).toBe('status');
    app.press('button.out', 'Plus tard');
    await vi.waitFor(() => {
      app.harness.detectChanges();
      expect(app.find('.backup')).toBeNull();
    });
    expect(localStorage.getItem('backupSnooze')).toBeTruthy();
  });

  it('annonce l’ancienneté de la dernière sauvegarde', async () => {
    localStorage.setItem('lastBackup', new Date(Date.now() - 20 * 864e5).toISOString());
    await boot();
    await app.go('/', 'Dernière sauvegarde il y a 20 jours');
  });

  it('ne s’affiche pas après une sauvegarde récente', async () => {
    localStorage.setItem('lastBackup', new Date().toISOString());
    await boot();
    await app.go('/', 'Mes bacs');
    expect(app.find('.backup')).toBeNull();
  });

  it('« Sauvegarder » lance l’export', async () => {
    await boot();
    await app.go('/', 'Aucune sauvegarde pour l’instant');
    const spy = vi.spyOn(TestBed.inject(BackupService), 'exportNow').mockResolvedValue();
    app.press('button.fill', 'Sauvegarder');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('à surveiller', () => {
  it('ne montre rien quand tout va bien', async () => {
    await boot((db) => db.inhabitants.delete('i2'));
    await app.go('/', 'Mes bacs');
    expect(app.find('.alerts')).toBeNull();
  });

  it('signale une valeur hors plage avec le nom du bac et mène à l’onglet eau', async () => {
    await boot((db) =>
      db.waterTests.put({
        id: 'w',
        updatedAt: U,
        tankId: 'a',
        date: '2026-10-20T10:00:00Z',
        values: { no3: 40, no2: 0.5 },
      }),
    );
    await app.go('/', 'À surveiller');
    const list = alerts().filter((a) => a.includes('Bac salon'));
    expect(list).toHaveLength(2);
    const no2 = list.find((a) => a.startsWith('NO2'))!;
    const no3 = list.find((a) => a.startsWith('NO3'))!;
    expect(no2).toContain('NO2 à 0,5 mg/L — Bac salon');
    expect(no2).toContain('Plage idéale 0–0,1 mg/L. Changement d’eau conseillé.');
    expect(no3).toContain('NO3 à 40 mg/L — Bac salon');
    expect(no3).toContain('Plage idéale 5–25 mg/L.');
    expect(no3).not.toContain('Changement d’eau conseillé');
    expect(app.find('.alert[href="/bacs/a/eau"]')).not.toBeNull();
    expect(app.find('.alert.danger')).not.toBeNull();
  });

  it('pendant un cyclage sans animaux, l’ammonium et les nitrites ne sont pas des alertes', async () => {
    await boot(async (db) => {
      await db.inhabitants.delete('i1');
      await db.tanks.update('a', { cycling: true });
      await db.waterTests.put({
        id: 'w',
        updatedAt: U,
        tankId: 'a',
        date: '2026-10-20T10:00:00Z',
        values: { nh4: 2, no2: 1, no3: 40 },
      });
    });
    await app.go('/', 'À surveiller');
    const mine = alerts().filter((a) => a.includes('Bac salon'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain('NO3');
  });

  it('avec des animaux, un cyclage ne masque pas les alertes', async () => {
    await boot(async (db) => {
      await db.tanks.update('a', { cycling: true });
      await db.waterTests.put({
        id: 'w',
        updatedAt: U,
        tankId: 'a',
        date: '2026-10-20T10:00:00Z',
        values: { nh4: 2 },
      });
    });
    await app.go('/', 'À surveiller');
    expect(alerts().some((a) => a.includes('NH4 à 2 mg/L'))).toBe(true);
  });

  it('prévient quand les nitrates montent vers la limite', async () => {
    const day = (n: number) => new Date(Date.now() - (21 - n * 7) * 864e5).toISOString();
    await boot((db) =>
      db.waterTests.bulkPut(
        [5, 10, 15, 20].map((v, i) => ({
          id: `w${i}`,
          updatedAt: U,
          tankId: 'a',
          date: day(i),
          values: { no3: v },
        })),
      ),
    );
    await app.go('/', 'Nitrates en hausse');
    expect(alerts()[0]).toMatch(/Nitrates en hausse — Bac salon/);
    expect(alerts()[0]).toMatch(
      /\+5 mg\/L par semaine : 25 mg\/L atteints dans ~\d+ j\. Prévois un changement d’eau\./,
    );
  });

  it('signale les constats ouverts du dernier bilan visuel et les problèmes de cohabitation', async () => {
    await boot(async (db) => {
      await db.observations.put({
        id: 'o',
        updatedAt: U,
        tankId: 'a',
        date: '2026-10-20T10:00:00Z',
        overall: 'watch',
        findings: [
          { category: 'algae', severity: 'danger', title: 'Algues noires', advice: ['Brosser'] },
          { category: 'algae', severity: 'warn', title: 'Voile', detail: 'Léger' },
          { category: 'algae', severity: 'warn', title: 'Autre' },
        ] as never,
      });
      await db.inhabitants.update('i1', { quantity: 2 });
    });
    await app.go('/', 'Algues noires');
    const list = alerts();
    expect(list.find((a) => a.startsWith('Algues noires — Bac salon'))).toContain('Brosser');
    expect(list.find((a) => a.startsWith('Voile — Bac salon'))).toContain('Léger');
    expect(list.find((a) => a.startsWith('Autre — Bac salon'))).toContain(
      'Constat du dernier bilan visuel.',
    );
    expect(list.find((a) => a.startsWith('Groupe trop petit'))).toContain('Bac salon');
    expect(app.find('.alert[href="/bacs/a/population"]')).not.toBeNull();
  });

  it('signale les consommables vides et périmés, pas ceux qui sont seulement bas', async () => {
    await boot(async (db) => {
      await db.consumables.clear();
      await db.consumables.bulkPut([
        { id: 'c1', updatedAt: U, name: 'Vide', category: 'food', level: 'empty' },
        { id: 'c2', updatedAt: U, name: 'Bas', category: 'food', level: 'low' },
        {
          id: 'c3',
          updatedAt: U,
          name: 'Test NO3',
          category: 'test_kit',
          level: 'full',
          expiryDate: '2020-01-01',
        },
      ]);
    });
    await app.go('/', 'À surveiller');
    const list = alerts();
    expect(list.some((a) => a.includes('Vide : vide'))).toBe(true);
    expect(list.some((a) => a.includes('Test NO3 : périmé'))).toBe(true);
    expect(list.some((a) => a.includes('Bas'))).toBe(false);
    expect(app.find('.alert[href="/materiel?vue=consommables"]')).not.toBeNull();
    expect(app.find('.alert.danger')?.textContent).toContain('Test NO3');
  });

  it('une garantie qui se termine ou un équipement mène à l’onglet équipements', async () => {
    await boot(async (db) => {
      await db.consumables.clear();
      await db.consumables.put({
        id: 'c1',
        updatedAt: U,
        name: 'Vide',
        category: 'food',
        level: 'empty',
      });
    });
    await app.go('/', 'À surveiller');
    expect(app.find('.alert[href="/materiel?vue=consommables"]')!.textContent).toContain('Vide');
  });
});

describe('entretien du jour', () => {
  it('dit quand il n’y a rien à faire', async () => {
    await boot((db) =>
      db.tasks.put(task('Plus tard', { nextDue: addDays(today, 3) })).then(() => undefined),
    );
    await app.go('/', 'Rien à faire aujourd’hui.');
    expect(app.find('.sub', '0 tâche')).not.toBeNull();
  });

  it('liste les tâches dues, avec le bac et le retard, et compte les retards', async () => {
    await boot((db) =>
      db.tasks
        .bulkPut([
          task('Aujourd’hui'),
          task('En retard', { nextDue: addDays(today, -2), tankId: 'b' }),
          task('Demain', { nextDue: addDays(today, 1) }),
        ])
        .then(() => undefined),
    );
    await app.go('/', 'En retard');
    expect(tasks()).toHaveLength(2);
    expect(tasks()[0]).toContain('En retard Nano · en retard de 2 j');
    expect(tasks()[1]).toContain('Aujourd’hui Bac salon · aujourd’hui');
    expect(app.find('h2', 'Entretien du jour')!.parentElement!.textContent).toMatch(
      /2 tâches\s*· 1 en retard/,
    );
    expect(app.find('button.done')!.getAttribute('aria-label')).toBe(
      'En retard : marquer comme fait',
    );
    expect(app.el().querySelectorAll('button.done.late')).toHaveLength(1);
  });

  it('accorde « tâche » au singulier', async () => {
    await boot((db) => db.tasks.put(task('Seule')).then(() => undefined));
    await app.go('/', 'Seule');
    expect(app.find('h2', 'Entretien du jour')!.parentElement!.textContent).toMatch(/1 tâche(?!s)/);
    expect(app.find('h2', 'Entretien du jour')!.parentElement!.textContent).not.toContain(
      'en retard',
    );
  });

  it('valider une tâche simple la reporte', async () => {
    await boot((db) => db.tasks.put(task('Vitres', { type: 'glass_clean' })).then(() => undefined));
    await app.go('/', 'Vitres');
    app.press('button.done');
    await vi.waitFor(async () =>
      expect((await app.db.tasks.get('Vitres'))!.nextDue).toBe(addDays(today, 7)),
    );
    await vi.waitFor(() => {
      app.harness.detectChanges();
      expect(app.find('.task')).toBeNull();
    });
  });

  it('un changement d’eau passe par la fenêtre du pourcentage', async () => {
    await boot((db) => db.tasks.put(task('Eau', { type: 'water_change' })).then(() => undefined));
    await app.go('/', 'Eau');
    app.press('button.done');
    expect(app.find('[role=dialog]')?.getAttribute('aria-labelledby')).toBe('wc-title');
    expect(await app.db.logs.where('taskId').equals('Eau').count()).toBe(0);
    app.press('[role=dialog] .btn.fill', 'C’est fait');
    await vi.waitFor(async () =>
      expect(await app.db.logs.where('taskId').equals('Eau').count()).toBe(1),
    );
  });

  it('une fertilisation passe par la saisie des doses', async () => {
    await boot((db) => db.tasks.put(task('Engrais', { type: 'fertilize' })).then(() => undefined));
    await app.go('/', 'Engrais');
    app.press('button.done');
    expect(app.find('[role=dialog]')?.getAttribute('aria-labelledby')).toBe('dose-title');
  });
});
