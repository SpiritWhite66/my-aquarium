// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp, closeApp, seedAll, type App } from '../../testing/app.testing';

const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let app: App;
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(async () => {
  click.mockRestore();
  vi.unstubAllGlobals();
  await closeApp(app);
});

const U = '';
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const photo = (id: string, ago: number, tankId = 'a') => ({ id, updatedAt: U, tankId, date: daysAgo(ago), width: 10, height: 10 });

async function boot(opts: { photos?: number; diagnosisAgo?: number | null; tests?: boolean } = {}) {
  const { photos = 0, diagnosisAgo = 10, tests = false } = opts;
  app = await bootApp(async (db) => {
    await seedAll(db);
    await db.diagnoses.clear();
    if (diagnosisAgo != null) {
      await db.diagnoses.put({
        id: 'g1', updatedAt: U, tankId: 'a', date: daysAgo(diagnosisAgo), summary: 'Algues', hypotheses: [{ title: 'Excès de lumière', probability: 'high' }],
        actions: [{ title: 'Réduire', priority: 'now', done: true }, { title: 'Observer', priority: 'later' }], followUp: { inDays: 14, measure: ['NO3', 'Observer les poissons'] },
      });
    }
    if (!tests) await db.waterTests.clear();
    for (let n = 1; n <= photos; n++) {
      await db.photos.put(photo(`p${n}`, n * 2));
      await db.photoFiles.put({ id: `p${n}`, full: new Blob([`full${n}`]), thumb: new Blob(['t']) });
    }
  });
}
const picks = () => [...app.el().querySelectorAll('.ph-pick')];
const selected = () => picks().filter((p) => p.classList.contains('on')).length;
const summary = () => app.find('.summary')?.textContent!.replace(/\s+/g, ' ');

describe('page de diagnostic', () => {
  it('invite à créer un bac quand il n’y en a pas', async () => {
    app = await bootApp(async () => undefined);
    await app.go('/diagnostic', 'Crée d’abord un bac.');
  });

  it('prépare le dossier du bac demandé et résume son contenu', async () => {
    await boot({ photos: 2 });
    await app.go('/diagnostic?bac=a', 'Contenu du dossier');
    expect((app.el().querySelector('#tank') as HTMLSelectElement).value).toBe('a');
    expect(summary()).toContain('1 espèces · 0 relevés · 1 équipements · 1 opérations d’entretien · 1 diagnostic(s) précédent(s) · 2 photo(s)');
    expect(app.find('a', 'Importer depuis l’IA')!.getAttribute('href')).toBe('/import-ia?bac=a');
    expect(app.find('a.ton', 'Skill diagnostic')!.getAttribute('href')).toBe('ai/my-aquarium-diagnostic.zip');
  });

  it('liste ce qui manque pour un meilleur diagnostic', async () => {
    await boot();
    await app.go('/diagnostic?bac=a', 'Manque pour un meilleur diagnostic');
    expect(summary()).toContain('Manque pour un meilleur diagnostic : relevés d’eau, débit du filtre, photos.');
    await app.db.waterTests.put({ id: 'w', updatedAt: U, tankId: 'a', date: daysAgo(1), values: { ph: 7 } });
    await vi.waitFor(() => {
      app.harness.detectChanges();
      expect(summary()).toContain('NO3, PO4, KH');
    });
  });

  it('changer de bac recalcule le dossier', async () => {
    await boot();
    await app.go('/diagnostic?bac=a', 'Contenu du dossier');
    const sel = app.el().querySelector('#tank') as HTMLSelectElement;
    sel.value = 'b';
    sel.dispatchEvent(new Event('change'));
    app.harness.detectChanges();
    expect(summary()).toContain('1 equipements'.replace('equipements', 'équipements'));
    expect(app.find('.fu')).toBeNull();
  });

  describe('photos jointes', () => {
    it('prend par défaut les trois plus récentes et en permet le choix, dans la limite', async () => {
      await boot({ photos: 6, diagnosisAgo: null });
      await app.go('/diagnostic?bac=a', 'Photos jointes');
      await app.until(() => picks().length === 6);
      expect(selected()).toBe(3);
      expect(app.find('h2', 'Photos jointes')!.textContent).toMatch(/3 \/ \d+/);
      app.click(picks()[5]);
      expect(selected()).toBe(4);
      app.click(picks()[5]);
      expect(selected()).toBe(3);
      expect(picks()[0].getAttribute('aria-pressed')).toBe('true');
      expect(picks()[5].getAttribute('aria-pressed')).toBe('false');
      expect(picks()[0].getAttribute('aria-label')).toMatch(/^Joindre la photo du /);
      for (const p of picks()) app.click(p);
      expect(selected()).toBeLessThanOrEqual(6);
    });

    it('dit quand le bac n’a aucune photo', async () => {
      await boot({ diagnosisAgo: null });
      await app.go('/diagnostic?bac=a', 'Aucune photo pour ce bac.');
    });
  });

  describe('suivi d’un diagnostic précédent', () => {
    it('est proposé et coché quand le diagnostic est récent', async () => {
      await boot();
      await app.go('/diagnostic?bac=a', 'Suivi du diagnostic du');
      expect((app.find('.fu input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
      expect(app.find('.fu')?.textContent).toContain('Excès de lumière');
      expect(app.find('.fu')?.textContent).toContain('suivi prévu dans 4 j');
      expect(app.find('.fu-h')?.textContent).toBe('Actions : 1 sur 2 faites');
      expect(app.el().querySelectorAll('.fu-l li.m-ok').length).toBe(1);
    });

    it('n’est pas coché quand le diagnostic date de plus de 90 jours', async () => {
      await boot({ diagnosisAgo: 120 });
      await app.go('/diagnostic?bac=a', 'Suivi du diagnostic du');
      expect((app.find('.fu input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
      expect(app.find('.fu-h')).toBeNull();
    });

    it('indique que le suivi est prévu aujourd’hui', async () => {
      await boot({ diagnosisAgo: 14 });
      await app.go('/diagnostic?bac=a', 'suivi prévu aujourd’hui');
    });

    it('indique la date du suivi quand elle est passée', async () => {
      await boot({ diagnosisAgo: 30 });
      await app.go('/diagnostic?bac=a', 'suivi prévu le');
    });

    it('signale les mesures demandées, faites ou non, et propose un relevé', async () => {
      await boot();
      await app.go('/diagnostic?bac=a', 'Mesures demandées');
      const items = [...app.el().querySelectorAll('.fu-l:last-of-type li')].map((l) => l.textContent.trim());
      expect(items).toEqual(['NO3', 'Observer les poissons']);
      expect(app.find('a', 'Faire un relevé avant d’envoyer')!.getAttribute('href')).toBe('/releve?bac=a');
      expect(app.find('li.m-unk')?.textContent).toContain('Observer les poissons');
      await app.db.waterTests.put({ id: 'w', updatedAt: U, tankId: 'a', date: daysAgo(1), values: { no3: 15 } });
      await vi.waitFor(() => {
        app.harness.detectChanges();
        expect(app.find('li', 'NO3 : 15')).not.toBeNull();
        expect(app.find('a', 'Faire un relevé avant d’envoyer')).toBeNull();
      });
    });

    it('décocher le suivi retire le bilan du dossier', async () => {
      await boot();
      await app.go('/diagnostic?bac=a', 'Suivi du diagnostic du');
      app.click(app.find('.fu input[type=checkbox]'));
      expect(app.find('.fu-h')).toBeNull();
    });

    it('en suivi, joint les photos prises depuis plus la dernière d’avant', async () => {
      await boot({ photos: 0 });
      for (const [id, ago] of [['old', 30], ['new1', 3], ['new2', 5]] as const) {
        await app.db.photos.put(photo(id, ago));
        await app.db.photoFiles.put({ id, full: new Blob(['f']), thumb: new Blob(['t']) });
      }
      await app.go('/diagnostic?bac=a', 'Photos jointes');
      await app.until(() => picks().length === 3);
      expect(selected()).toBe(3);
    });
  });

  describe('envoi', () => {
    it('partage le dossier et les photos quand le navigateur sait le faire', async () => {
      await boot({ photos: 2, tests: true });
      const share = vi.fn(async () => undefined);
      vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
      await app.go('/diagnostic?bac=a', 'Contenu du dossier');
      app.type(app.el().querySelector('#q'), 'Algues filamenteuses');
      app.press('button.fill', 'Envoyer à l’IA');
      await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const arg = (share.mock.calls[0] as unknown as [{ files: File[]; text: string }])[0];
      expect(arg.files.map((f) => f.name)).toEqual([expect.stringMatching(/^dossier-bac-salon-\d{4}-\d{2}-\d{2}\.json$/), expect.stringMatching(/^photo-1-/), expect.stringMatching(/^photo-2-/)]);
      expect(arg.text).toContain('Diagnostic de mon aquarium « Bac salon »');
      expect(arg.text).toContain('Mon problème : Algues filamenteuses');
      expect(arg.text).toContain('C\'est le suivi de ton diagnostic du');
      const dossier = JSON.parse(await arg.files[0].text());
      expect(dossier).toMatchObject({ format: 'my-aquarium-dossier', question: 'Algues filamenteuses', tank: { name: 'Bac salon' } });
      expect(dossier.sinceLastDiagnosis).toBeDefined();
      await vi.waitFor(() => expect(app.find('.msg')?.textContent).toContain('Dossier envoyé.'));
    });

    it('sans partage possible, télécharge les fichiers et copie la demande', async () => {
      await boot({ photos: 1 });
      const writeText = vi.fn(async () => undefined);
      vi.stubGlobal('navigator', { ...navigator, canShare: undefined, clipboard: { writeText } });
      await app.go('/diagnostic?bac=a', 'Contenu du dossier');
      app.press('button.fill', 'Envoyer à l’IA');
      await vi.waitFor(() => expect(app.find('.msg')?.textContent).toContain('Fichiers téléchargés et demande copiée'), { timeout: 4000 });
      expect(click).toHaveBeenCalledTimes(2);
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Bac salon'));
      expect(app.find('button.fill', 'Envoyer')!.hasAttribute('disabled')).toBe(false);
    });

    it('un partage annulé ne laisse aucun message et libère le bouton', async () => {
      await boot();
      vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: async () => { throw new DOMException('annulé', 'AbortError'); } });
      await app.go('/diagnostic?bac=a', 'Contenu du dossier');
      app.press('button.fill', 'Envoyer à l’IA');
      await new Promise((r) => setTimeout(r, 50));
      app.harness.detectChanges();
      expect(app.find('.msg')).toBeNull();
      expect(app.find('button.fill', 'Envoyer')!.hasAttribute('disabled')).toBe(false);
    });

    it('sans suivi, la demande ne mentionne pas de diagnostic précédent', async () => {
      await boot({ diagnosisAgo: null });
      const share = vi.fn(async () => undefined);
      vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
      await app.go('/diagnostic?bac=a', 'Contenu du dossier');
      app.press('button.fill', 'Envoyer à l’IA');
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      expect((share.mock.calls[0] as unknown as [{ text: string }])[0].text).not.toContain('suivi de ton diagnostic');
      expect((share.mock.calls[0] as unknown as [{ text: string }])[0].text).toContain('Fais un bilan général');
    });
  });

  it('télécharge le dossier et les photos', async () => {
    await boot({ photos: 1, diagnosisAgo: null });
    await app.go('/diagnostic?bac=a', 'Contenu du dossier');
    app.press('button.out', 'Télécharger');
    await vi.waitFor(() => expect(app.find('.msg')?.textContent).toBe('Dossier et photos téléchargés.'), { timeout: 4000 });
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('copie le prompt et le confirme un instant', async () => {
    await boot();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal('fetch', async (url: string) => ({ text: async () => 'PROMPT ' + url }));
    await app.go('/diagnostic?bac=a', 'Contenu du dossier');
    app.press('button.out', 'Copier le prompt');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('PROMPT ai/diagnostic-prompt.md'));
    await vi.waitFor(() => expect(app.el().textContent).toContain('Prompt copié'));
  });
});
