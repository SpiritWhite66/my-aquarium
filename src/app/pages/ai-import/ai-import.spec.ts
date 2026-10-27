import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

let app: App;
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeApp(app);
});

const env = (kind: string, data: unknown) => ({ format: 'my-aquarium-ai', version: 1, kind, data });
const inventory = env('inventory', {
  items: [
    {
      scientificName: 'Danio margaritatus',
      kind: 'fish',
      quantity: 15,
      unit: 'individual',
      confidence: 'high',
    },
    {
      scientificName: 'Xenomystus nigri',
      commonName: 'Poisson couteau',
      kind: 'fish',
      quantity: 20,
      quantityIsEstimate: true,
      unit: 'individual',
      confidence: 'medium',
    },
  ],
});
const waterTest = env('water_test', {
  method: 'drops',
  values: { ph: { value: 7.2, confidence: 'high' }, no3: { value: 25, confidence: 'low' } },
});
const sanity = env('sanity', {
  overall: 'watch',
  summary: 'Quelques algues',
  findings: [
    {
      category: 'algae',
      severity: 'warn',
      title: 'Algues filamenteuses',
      confidence: 'medium',
      advice: ['Retirer'],
    },
  ],
});
const diagnosis = env('diagnosis', {
  summary: 'Trop de lumière',
  hypotheses: [{ title: 'Excès de lumière', probability: 'high', evidence: ['NO3 élevé'] }],
  actions: [
    {
      title: 'Réduire la lumière',
      priority: 'now',
      task: { type: 'custom', label: 'Réduire la lumière' },
    },
    { title: 'Observer', priority: 'later' },
  ],
  followUp: { inDays: 7, measure: ['NO3'] },
});

const json = () => app.el().querySelector<HTMLTextAreaElement>('#json')!;
async function analyze(...payloads: unknown[]) {
  app.type(json(), payloads.map((p) => '```json\n' + JSON.stringify(p) + '\n```').join('\n'));
  app.press('button.fill', 'Analyser');
  await app.flush();
}
const save = () => app.find('button.fill', /Importer|Enregistrer/);

describe('import depuis l’IA', () => {
  beforeEach(async () => {
    app = await bootApp();
    await app.go('/import-ia?bac=a', 'Importer depuis l’IA');
  });

  it('propose le bac demandé dans l’adresse', () => {
    expect(
      (app.el().querySelector('#tank') as HTMLSelectElement).selectedOptions[0].textContent,
    ).toContain('Bac salon');
    expect(app.find('button.fill', 'Analyser')!.hasAttribute('disabled')).toBe(true);
  });

  it('explique ce qui ne va pas dans un texte qui n’est pas importable', async () => {
    app.type(json(), 'Je ne vois pas bien la photo.');
    app.press('button.fill', 'Analyser');
    expect(app.find('.errors')?.textContent).toContain('Ce JSON ne peut pas être importé');
    expect(app.el().querySelector('[role=alert]')).not.toBeNull();
  });

  it('montre l’inventaire, reconnaît les espèces connues et remplace par défaut la quantité existante', async () => {
    await analyze(inventory);
    // Les espèces et habitants existants arrivent de la base après l'analyse.
    await vi.waitFor(() => {
      const rows = [...app.el().querySelectorAll('.inv')];
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('Danio margaritatus');
      expect(rows[0].textContent).toMatch(/12/);
      expect((rows[0].querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(
        true,
      );
    });
  });

  it('enregistre l’inventaire : met à jour l’existant et crée une fiche pour l’espèce inconnue', async () => {
    await analyze(inventory);
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () => expect((await app.db.inhabitants.get('i1'))?.quantity).toBe(15));
    await vi.waitFor(async () =>
      expect((await app.db.inhabitants.toArray()).some((i) => i.origin === 'Inventaire IA')).toBe(
        true,
      ),
    );
    const shrimp = (await app.db.inhabitants.toArray()).find((i) => i.origin === 'Inventaire IA');
    expect(shrimp).toMatchObject({
      quantity: 20,
      approximate: true,
      tankId: 'a',
      status: 'healthy',
    });
    const sp = await app.db.species.get(shrimp!.speciesId);
    expect(sp).toMatchObject({
      scientificName: 'Xenomystus nigri',
      source: 'custom',
      commonNames: ['Poisson couteau'],
    });
    expect(
      (await app.db.inhabitantEvents.toArray()).some((e) => e.note === 'Inventaire IA : 12 → 15'),
    ).toBe(true);
    await vi.waitFor(() => expect(app.harness.routeNativeElement?.textContent).toContain('Danio'));
  });

  it('décocher « remplacer » ajoute à l’existant ; décocher une ligne l’ignore', async () => {
    await analyze(inventory);
    const boxes = [...app.el().querySelectorAll<HTMLInputElement>('.inv input[type=checkbox]')];
    // ligne 1 : [importer, remplacer] ; ligne 2 : [importer]
    app.click(boxes[1]);
    app.click(boxes[2]);
    expect(app.el().querySelectorAll('.inv.off')).toHaveLength(1);
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () => expect((await app.db.inhabitants.get('i1'))?.quantity).toBe(27));
    expect((await app.db.inhabitants.toArray()).some((i) => i.origin === 'Inventaire IA')).toBe(
      false,
    );
  });

  it('corrige une quantité avant d’enregistrer et ignore une quantité nulle', async () => {
    await analyze(inventory);
    const qty = [...app.el().querySelectorAll<HTMLInputElement>('.inv input.num')];
    app.type(qty[0], '18');
    app.type(qty[1], '0');
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () => expect((await app.db.inhabitants.get('i1'))?.quantity).toBe(18));
    expect((await app.db.inhabitants.toArray()).some((i) => i.origin === 'Inventaire IA')).toBe(
      false,
    );
  });

  it('enregistre un relevé lu sur photo en signalant les valeurs incertaines', async () => {
    await analyze(waterTest);
    expect(app.el().textContent).toContain('pH');
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () =>
      expect((await app.db.waterTests.toArray()).some((w) => w.method === 'drops')).toBe(true),
    );
    const w = (await app.db.waterTests.toArray()).find((x) => x.method === 'drops')!;
    expect(w.values).toMatchObject({ ph: 7.2, no3: 25 });
    expect(w.note).toBe('Lu par une IA sur photo · à vérifier : NO3');
    await vi.waitFor(() =>
      expect(app.harness.routeNativeElement?.textContent).toContain('Dernier relevé'),
    );
  });

  it('un relevé dont toutes les lignes sont décochées n’est pas enregistré', async () => {
    await analyze(waterTest);
    for (const box of app.el().querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
      app.click(box);
    expect(save()!.hasAttribute('disabled')).toBe(true);
  });

  it('corrige une valeur du relevé avant enregistrement', async () => {
    await analyze(waterTest);
    const first = app.el().querySelector<HTMLInputElement>('input.num[inputmode=decimal]')!;
    app.type(first, '6,8');
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () =>
      expect(
        (await app.db.waterTests.toArray()).some(
          (w) => w.values.ph === 6.8 || w.values.no3 === 6.8,
        ),
      ).toBe(true),
    );
  });

  it('enregistre un bilan visuel et un diagnostic avec les tâches cochées', async () => {
    await analyze(sanity, diagnosis);
    expect(app.el().textContent).toContain('Algues filamenteuses');
    expect(app.el().textContent).toContain('Trop de lumière');
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () => expect(await app.db.diagnoses.count()).toBe(2));
    const obs = (await app.db.observations.toArray()).find((o) => o.summary === 'Quelques algues')!;
    expect(obs).toMatchObject({ overall: 'watch', tankId: 'a' });
    const d = (await app.db.diagnoses.toArray()).find((x) => x.summary === 'Trop de lumière')!;
    expect(d.actions[0].taskId).toBeDefined();
    expect(d.actions[1].taskId).toBeUndefined();
    expect(
      (await app.db.tasks.toArray()).some(
        (t) => t.diagnosisId === d.id && t.label === 'Réduire la lumière',
      ),
    ).toBe(true);
  });

  it('décocher la création de tâche du diagnostic', async () => {
    await analyze(diagnosis);
    const box = [...app.el().querySelectorAll<HTMLInputElement>('input[type=checkbox]')].at(-1)!;
    app.click(box);
    app.press('button.fill', 'Importer');
    await vi.waitFor(async () => expect(await app.db.diagnoses.count()).toBe(2));
    const d = (await app.db.diagnoses.toArray()).find((x) => x.summary === 'Trop de lumière')!;
    expect(d.actions[0].taskId).toBeUndefined();
  });

  it('« Annuler » revient à la saisie vide', async () => {
    await analyze(inventory);
    app.press('button.out', 'Annuler');
    expect(json().value).toBe('');
    expect(app.el().querySelector('.inv')).toBeNull();
  });

  it('changer de bac recalcule les quantités déjà présentes', async () => {
    await analyze(inventory);
    expect(app.el().querySelector('.inv')!.textContent).toMatch(/12/);
    const sel = app.el().querySelector('#tank2') as HTMLSelectElement;
    sel.value = 'b';
    sel.dispatchEvent(new Event('change'));
    app.harness.detectChanges();
    expect(app.el().querySelector('.inv')!.textContent).not.toMatch(/12/);
  });

  it('colle depuis le presse-papiers, ou explique pourquoi c’est impossible', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { readText: async () => JSON.stringify(inventory) },
    });
    app.press('button.ton', 'Coller');
    await vi.waitFor(() => expect(app.el().querySelectorAll('.inv')).toHaveLength(2));
  });

  it('un presse-papiers inaccessible est signalé', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        readText: async () => {
          throw new Error('refus');
        },
      },
    });
    app.press('button.ton', 'Coller');
    await vi.waitFor(() => expect(app.find('.errors')?.textContent).toContain('presse-papiers'));
  });

  it('lit un fichier .json', async () => {
    const input = app.el().querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([JSON.stringify(sanity)], 'bilan.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(app.el().textContent).toContain('Algues filamenteuses'));
  });

  it('copie le prompt et le confirme un instant', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal('fetch', async () => ({ text: async () => 'PROMPT' }));
    app.press('button.out', 'Copier le prompt');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('PROMPT'));
    await vi.waitFor(() => expect(app.el().textContent).toContain('Prompt copié'));
  });
});

describe('import reçu depuis une autre appli (partage)', () => {
  it('analyse tout de suite le texte partagé', async () => {
    app = await bootApp();
    await app.go(
      '/import-ia?bac=b&text=' + encodeURIComponent(JSON.stringify(inventory)),
      'Inventaire',
    );
    await vi.waitFor(() => expect(app.el().querySelectorAll('.inv')).toHaveLength(2));
  });

  it('demande de créer un bac quand il n’y en a pas', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/import-ia', 'Crée d’abord un bac');
  });
});
