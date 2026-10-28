// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, todayIso } from '../../core/dates';
import { bootApp, closeApp, seedAll, type App } from '../../testing/app.testing';
import { daysAgoIso } from '../../testing/dates.testing';

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
const dialog = () => app.find('[role=dialog]');

async function boot(seed: (db: App['db']) => PromiseLike<unknown> = async () => undefined) {
  app = await bootApp(async (db) => {
    await seedAll(db);
    await db.tasks.clear();
    await seed(db);
  });
}

describe('tâches à venir', () => {
  it('liste les tâches avec leur fréquence et leur échéance', async () => {
    await boot((db) =>
      db.tasks
        .bulkPut([
          task('Retard', { nextDue: addDays(today, -3) }),
          task('Auj', { nextDue: today, everyDays: 1 }),
          task('Demain', { nextDue: addDays(today, 1), everyDays: 30 }),
          task('Plus tard', { nextDue: addDays(today, 5), everyDays: 14 }),
          task('Off', { active: false }),
        ])
        .then(() => undefined),
    );
    await app.go('/bacs/a/entretien', 'Retard');
    const rows = [...app.el().querySelectorAll('.t')].map((r) =>
      r.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.startsWith('Retard'))).toContain('Hebdo · en retard de 3 j');
    expect(rows.find((r) => r.startsWith('Auj'))).toContain('Quotidien · aujourd’hui');
    expect(rows.find((r) => r.startsWith('Demain'))).toContain('Mensuel · demain');
    expect(rows.find((r) => r.startsWith('Plus tard'))).toContain('Toutes les 2 sem. · dans 5 j');
    expect(app.el().querySelectorAll('.late')).not.toHaveLength(0);
    expect(app.find('a.tn', 'Retard')!.getAttribute('href')).toBe('/bacs/a/taches/Retard');
    expect(app.find('a.tic')!.getAttribute('aria-label')).toMatch(/^Modifier /);
  });

  it('dit quand il n’y en a aucune', async () => {
    await boot();
    await app.go('/bacs/a/entretien', 'Aucune tâche récurrente.');
  });

  it('marquer une tâche faite la reporte et l’inscrit au journal', async () => {
    await boot((db) =>
      db.tasks
        .put(task('Vitres', { nextDue: addDays(today, -1), type: 'glass_clean' }))
        .then(() => undefined),
    );
    await app.go('/bacs/a/entretien', 'Vitres');
    app.press('button.done');
    await vi.waitFor(async () =>
      expect((await app.db.tasks.get('Vitres'))!.nextDue).toBe(addDays(today, 7)),
    );
    expect(
      (await app.db.logs.toArray()).some((l) => l.taskId === 'Vitres' && l.type === 'glass_clean'),
    ).toBe(true);
  });

  it('un changement d’eau ouvre d’abord la fenêtre du pourcentage, sans rien enregistrer', async () => {
    await boot((db) =>
      db.tasks
        .put(task('Eau', { type: 'water_change', label: 'Changement d’eau 40 %' }))
        .then(() => undefined),
    );
    await app.go('/bacs/a/entretien', 'Eau');
    app.press('button.done');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('wc-title');
    expect(app.find('.pcts button.on')?.textContent).toContain('40');
    expect(await app.db.logs.where('taskId').equals('Eau').count()).toBe(0);
    app.press('button[aria-label=Fermer]');
    expect(dialog()).toBeNull();
  });

  it('une fertilisation ouvre la saisie des doses', async () => {
    await boot((db) => db.tasks.put(task('Engrais', { type: 'fertilize' })).then(() => undefined));
    await app.go('/bacs/a/entretien', 'Engrais');
    app.press('button.done');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('dose-title');
  });

  it('« Noter une dose d’engrais » ouvre la même saisie, hors tâche', async () => {
    await boot();
    await app.go('/bacs/a/entretien', 'Noter une dose');
    app.press('button.linkbtn', 'Noter une dose');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('dose-title');
  });

  it('propose d’ajouter une tâche', async () => {
    await boot();
    await app.go('/bacs/a/entretien', 'Aucune tâche');
    expect(app.find('a.fab')!.getAttribute('href')).toBe('/bacs/a/taches/nouvelle');
  });
});

describe('matériel du bac', () => {
  it('liste le matériel du bac avec un résumé, et mène à sa fiche', async () => {
    await boot();
    await app.go('/bacs/a/entretien', 'Éclairage');
    const link = app.find('a.li', 'Éclairage')!;
    expect(link.getAttribute('href')).toBe('/materiel/equipement/e1');
    expect(link.textContent).toContain('60');
    expect(app.find('a.li', 'Filtre de rechange')).toBeNull();
    expect(app.find('a.more', 'Ajouter')!.getAttribute('href')).toContain(
      '/materiel/equipement/nouveau',
    );
    expect(app.find('a.more', 'Ajouter')!.getAttribute('href')).toContain('bac=a');
  });

  it('dit quand le bac n’a aucun équipement', async () => {
    await boot((db) => db.equipment.clear());
    await app.go('/bacs/a/entretien', 'Aucun équipement rattaché à ce bac.');
  });

  it('signale les points d’attention du matériel (alertes seulement)', async () => {
    await boot((db) =>
      db.equipment
        .update('e1', { light: { schedule: { on: '08:00', off: '20:00' } } })
        .then(() => undefined),
    );
    await app.go('/bacs/a/entretien', 'Éclairage long');
    expect(app.find('p.gc')?.textContent).toContain('Éclairage long : 12 h par jour');
    await app.db.equipment.update('e1', { light: { schedule: { on: '10:00', off: '18:00' } } });
    await vi.waitFor(() => {
      app.harness.detectChanges();
      expect(app.find('p.gc')).toBeNull();
    });
  });
});

describe('réglages du matériel', () => {
  const daysAgo = daysAgoIso;
  // Une seule date : les changements enregistrés ensemble ont exactement la même (sinon, une milliseconde
  // d'écart entre deux appels à Date.now() les sépare en deux groupes).
  const FORTY_DAYS_AGO = daysAgo(40);
  const change = (id: string, o: Record<string, unknown> = {}) => ({
    id,
    updatedAt: U,
    tankId: 'a',
    equipmentId: 'e1',
    equipmentName: 'Rampe',
    date: FORTY_DAYS_AGO,
    field: 'light.intensityPct' as const,
    from: '80 %',
    to: '60 %',
    ...o,
  });

  it('n’apparaît pas sans changement', async () => {
    await boot();
    await app.go('/bacs/a/entretien', 'Historique');
    expect(app.find('h2', 'Réglages du matériel')).toBeNull();
  });

  it('résume chaque changement avec sa note et un verdict prudent', async () => {
    await boot((db) =>
      db.settingChanges
        .bulkPut([
          change('c1', { note: 'Moins de lumière' }),
          change('c2', { field: 'light.schedule', from: '10:00–18:00', to: '10:00–17:00' }),
          change('c3', { equipmentId: 'e9', equipmentName: 'Autre', date: daysAgo(2) }),
          change('c4', { tankId: 'b' }),
        ])
        .then(() => undefined),
    );
    await app.go('/bacs/a/entretien', 'Réglages du matériel');
    const articles = [...app.el().querySelectorAll('article.sc')].map((a) =>
      a.textContent.replace(/\s+/g, ' '),
    );
    expect(articles).toHaveLength(2);
    const rampe = articles.find((a) => a.includes('Rampe'))!;
    expect(rampe).toContain('Intensité : 80 % → 60 %');
    expect(rampe).toContain('Horaires d’éclairage : 10:00–18:00 → 10:00–17:00');
    expect(rampe).toContain('Moins de lumière');
    expect(rampe).toContain('Pas assez de notes d’algues avant et après pour comparer.');
    expect(articles.find((a) => a.includes('Autre'))).toContain('Trop tôt pour juger (2 j)');
  });

  it('conclut quand il y a des notes d’algues des deux côtés', async () => {
    await boot(async (db) => {
      await db.settingChanges.put(change('c1'));
      const obs = (id: string, ago: number, level: number) => ({
        id,
        updatedAt: U,
        tankId: 'a',
        date: daysAgo(ago),
        overall: 'watch' as const,
        findings: [],
        algaeLevel: level as 0,
      });
      await db.observations.clear();
      await db.observations.bulkPut([obs('b', 45, 3), obs('a', 20, 1)]);
    });
    await app.go('/bacs/a/entretien', 'Moins d’algues');
    expect(app.find('.verdict.v-ok')?.textContent).toContain('niveau moyen 3/3 avant, 1/3 après');
  });

  it('prévient quand les algues ont augmenté', async () => {
    await boot(async (db) => {
      await db.settingChanges.put(change('c1'));
      const obs = (id: string, ago: number, level: number) => ({
        id,
        updatedAt: U,
        tankId: 'a',
        date: daysAgo(ago),
        overall: 'watch' as const,
        findings: [],
        algaeLevel: level as 0,
      });
      await db.observations.clear();
      await db.observations.bulkPut([obs('b', 45, 0), obs('a', 20, 3)]);
    });
    await app.go('/bacs/a/entretien', 'Plus d’algues');
    expect(app.find('.verdict.v-warn')).not.toBeNull();
  });

  it('retire un changement après confirmation', async () => {
    await boot((db) =>
      db.settingChanges
        .bulkPut([
          change('c1'),
          change('c2', { field: 'light.siesta', from: undefined, to: '13:00–15:00' }),
        ])
        .then(() => undefined),
    );
    await app.go('/bacs/a/entretien', 'Réglages du matériel');
    vi.stubGlobal('confirm', () => false);
    app.press('.acts button', 'Supprimer');
    await app.flush();
    expect(await app.db.settingChanges.count()).toBe(2);
    vi.stubGlobal('confirm', () => true);
    app.press('.acts button', 'Supprimer');
    await vi.waitFor(async () => expect(await app.db.settingChanges.count()).toBe(0));
  });

  it('propose de comparer les photos d’avant et d’après', async () => {
    await boot(async (db) => {
      await db.settingChanges.put(change('c1'));
      for (const [id, ago] of [
        ['p1', 50],
        ['p2', 20],
      ] as const) {
        await db.photos.put({
          id,
          updatedAt: U,
          tankId: 'a',
          date: daysAgo(ago),
          width: 10,
          height: 10,
        });
        await db.photoFiles.put({ id, full: new Blob(['f']), thumb: new Blob(['t']) });
      }
    });
    await app.go('/bacs/a/entretien', 'Comparer les photos avant / après');
    app.press('.acts button', 'Comparer les photos');
    expect(dialog()?.getAttribute('aria-label')).toBe('Comparaison avant et après');
    app.press('button[aria-label=Fermer]');
    expect(dialog()).toBeNull();
  });

  it('invite à prendre une photo quand il n’y en a qu’avant', async () => {
    await boot(async (db) => {
      await db.settingChanges.put(change('c1'));
      await db.photos.put({
        id: 'p1',
        updatedAt: U,
        tankId: 'a',
        date: daysAgo(50),
        width: 10,
        height: 10,
      });
      await db.photoFiles.put({ id: 'p1', full: new Blob(['f']), thumb: new Blob(['t']) });
    });
    await app.go('/bacs/a/entretien', 'Prends une photo du bac pour comparer avec avant.');
  });
});

describe('historique', () => {
  it('mêle le journal et les événements des habitants, du plus récent au plus ancien', async () => {
    await boot(async (db) => {
      await db.logs.clear();
      await db.inhabitantEvents.clear();
      await db.logs.put({
        id: 'l1',
        updatedAt: U,
        tankId: 'a',
        type: 'water_change',
        label: 'Changement d’eau',
        date: '2026-10-05T10:00:00Z',
        note: '20 L',
      });
      await db.inhabitantEvents.bulkPut([
        {
          id: 'e1',
          updatedAt: U,
          inhabitantId: 'i1',
          tankId: 'a',
          date: '2026-10-08T10:00:00Z',
          type: 'death',
          quantityDelta: -2,
        },
        {
          id: 'e2',
          updatedAt: U,
          inhabitantId: 'i1',
          tankId: 'a',
          date: '2026-10-02T10:00:00Z',
          type: 'birth',
          quantityDelta: 3,
          note: 'alevins',
        },
        {
          id: 'e3',
          updatedAt: U,
          inhabitantId: 'i2',
          tankId: 'b',
          date: '2026-10-09T10:00:00Z',
          type: 'note',
        },
      ]);
    });
    await app.go('/bacs/a/entretien', 'Changement d’eau');
    // Le catalogue se charge à part : attendre le nom de l'espèce, pas seulement le journal.
    await app.until(() => app.el().textContent.includes('Rasbora galaxy (-2)'));
    const events = [...app.el().querySelectorAll('.ev')].map((e) =>
      e.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toContain('Rasbora galaxy (-2)');
    expect(events[1]).toContain('Changement d’eau');
    expect(events[1]).toContain('· 20 L');
    expect(events[2]).toContain('Rasbora galaxy (+3)');
    expect(events[2]).toContain('· alevins');
  });

  it('dit quand il n’y a rien', async () => {
    await boot(async (db) => {
      await db.logs.clear();
      await db.inhabitantEvents.clear();
    });
    await app.go('/bacs/a/entretien', 'Rien pour l’instant.');
  });

  it('limite l’historique aux 30 derniers éléments', async () => {
    await boot(async (db) => {
      await db.inhabitantEvents.clear();
      await db.logs.clear();
      await db.logs.bulkPut(
        Array.from({ length: 40 }, (_, n) => ({
          id: `l${n}`,
          updatedAt: U,
          tankId: 'a',
          type: 'custom' as const,
          label: `Entrée ${n}`,
          date: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
        })),
      );
    });
    await app.go('/bacs/a/entretien', 'Entrée 39');
    expect(app.el().querySelectorAll('.ev')).toHaveLength(30);
    expect(app.find('.ev', 'Entrée 10')).not.toBeNull();
    expect(app.find('.ev', 'Entrée 9 ')).toBeNull();
  });
});
