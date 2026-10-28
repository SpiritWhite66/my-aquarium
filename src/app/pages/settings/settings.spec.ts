// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_REMINDER_DAYS, BackupService, fmtBytes } from '../../core/backup';
import { AquariumStore } from '../../core/store';
import { PrefsStore } from '../../core/stores/prefs.store';
import { ACCOUNTS_ENABLED, API_URL } from '../../core/api-config';
import { AuthService } from '../../core/auth';
import { DiagLog } from '../../core/diag';
import { PushService } from '../../core/push';
import { DEFAULT_PREFS } from '../../core/reminders';
import { ThemeService } from '../../core/theme';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

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
  localStorage.clear();
  vi.stubGlobal('confirm', () => true);
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(async () => {
  // L'appli d'abord : ses vérifications en cours finissent avant qu'on retire les fausses API.
  await closeApp(app);
  click.mockRestore();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)['showSaveFilePicker'];
});

function fakeNotification(permission = 'granted') {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
  }
  vi.stubGlobal('Notification', FakeNotification);
  (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  return FakeNotification;
}
const message = () => app.find('.msg')?.textContent;
const file = (content: string, name = 'sauvegarde.json') =>
  new File([content], name, { type: 'application/json' });
function pick(input: HTMLInputElement, f: File) {
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('réglages', () => {
  it('liste les bacs et mène à leur modification', async () => {
    app = await bootApp();
    await app.go('/reglages', 'Bac salon');
    const links = [...app.el().querySelectorAll('a.it')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/bacs/a/modifier');
    expect(links).toContain('/bacs/nouveau');
    expect(app.el().textContent).toContain('60 L · Planté');
  });

  it('change le thème', async () => {
    app = await bootApp();
    await app.go('/reglages', 'Thème');
    app.press('.seg button', 'Sombre');
    expect(TestBed.inject(ThemeService).choice()).toBe('dark');
    expect(app.find('.seg button.on')!.textContent).toBe('Sombre');
    expect(app.find('.seg button', 'Sombre')!.getAttribute('aria-pressed')).toBe('true');
  });

  describe('catalogue en ligne', () => {
    const catalogSwitch = () =>
      app.el().querySelectorAll<HTMLInputElement>('input[role=switch]')[1];

    it('est indisponible tant qu’aucune API n’est configurée', async () => {
      TestBed.overrideProvider(API_URL, { useValue: null });
      app = await bootApp();
      await app.go('/reglages', 'Catalogue en ligne');
      expect(catalogSwitch().disabled).toBe(true);
      expect(app.el().textContent).toContain('Service pas encore disponible.');
    });

    it('est désactivé par défaut et ne contacte pas le serveur', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      TestBed.overrideProvider(API_URL, { useValue: 'https://api.exemple.test' });
      app = await bootApp();
      await app.go('/reglages', 'Catalogue en ligne');
      expect(catalogSwitch().disabled).toBe(false);
      expect(catalogSwitch().checked).toBe(false);
      expect(app.el().textContent).toContain('utilise son catalogue intégré');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('l’activer télécharge le catalogue puis affiche « à jour »', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'espece-serveur',
                kind: 'fish',
                scientificName: 'Serveur specius',
                commonNames: ['Poisson du serveur'],
                updatedAt: '2027-01-01T10:00:00.000Z',
                deletedAt: null,
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', fetchMock);
      TestBed.overrideProvider(API_URL, { useValue: 'https://api.exemple.test' });
      app = await bootApp();
      await app.go('/reglages', 'Catalogue en ligne');
      catalogSwitch().checked = true;
      catalogSwitch().dispatchEvent(new Event('change'));
      await app.until(() => app.el().textContent.includes('Catalogue à jour.'));
      expect(await app.db.species.get('espece-serveur')).toBeDefined();
      expect(app.find('button', 'Mettre à jour maintenant')).not.toBeNull();
    });

    it('signale un serveur injoignable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      TestBed.overrideProvider(API_URL, { useValue: 'https://api.exemple.test' });
      app = await bootApp();
      await app.go('/reglages', 'Catalogue en ligne');
      catalogSwitch().checked = true;
      catalogSwitch().dispatchEvent(new Event('change'));
      await app.until(() => app.el().textContent.includes('Serveur injoignable'));
    });
  });

  describe('rappels', () => {
    it('désactive l’interrupteur quand le navigateur ne gère pas les notifications', async () => {
      vi.stubGlobal('Notification', undefined);
      delete (window as unknown as Record<string, unknown>)['Notification'];
      app = await bootApp();
      await app.go('/reglages', 'Notifications');
      expect(app.find('input[role=switch]')!.hasAttribute('disabled')).toBe(true);
      expect(app.el().textContent).toContain('ne gère pas les notifications');
    });

    it('signale des notifications bloquées', async () => {
      fakeNotification('denied');
      app = await bootApp();
      await app.go('/reglages', 'Bloquées dans les réglages');
    });

    it('active puis désactive les rappels et enregistre les préférences', async () => {
      fakeNotification();
      app = await bootApp();
      await app.go('/reglages', 'Notifications');
      const sw = app.find('input[role=switch]') as HTMLInputElement;
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
      await vi.waitFor(async () =>
        expect(
          (await app.db.prefs.toArray()).some((p) => JSON.stringify(p).includes('"enabled":true')),
        ).toBe(true),
      );
      await app.until(() => !!app.find('input[type=time]'));
      const time = app.find('input[type=time]') as HTMLInputElement;
      time.value = '07:30';
      time.dispatchEvent(new Event('change'));
      const tasks = app
        .find('label.check', 'Tâches dues')!
        .querySelector('input') as HTMLInputElement;
      tasks.checked = false;
      tasks.dispatchEvent(new Event('change'));
      await vi.waitFor(() =>
        expect(TestBed.inject(PrefsStore).notificationPrefs()).toMatchObject({
          enabled: true,
          time: '07:30',
          tasks: false,
        }),
      );
      sw.checked = false;
      sw.dispatchEvent(new Event('change'));
      await vi.waitFor(() =>
        expect(TestBed.inject(PrefsStore).notificationPrefs().enabled).toBe(false),
      );
    });

    it('une heure vidée revient à 9 h', async () => {
      fakeNotification();
      app = await bootApp();
      await app.go('/reglages', 'Notifications');
      const sw = app.find('input[role=switch]') as HTMLInputElement;
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
      await app.until(() => !!app.find('input[type=time]'));
      app.type(app.find('input[type=time]'), '');
      await vi.waitFor(() =>
        expect(TestBed.inject(PrefsStore).notificationPrefs().time).toBe('09:00'),
      );
    });
  });

  it('exporte les tâches vers l’agenda', async () => {
    app = await bootApp();
    await app.go('/reglages', 'Ajouter à mon agenda');
    app.press('button.it', 'Ajouter à mon agenda');
    expect(click).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/calendar');
    expect(await blob.text()).toContain('BEGIN:VCALENDAR');
  });

  describe('mode vacances', () => {
    beforeEach(async () => {
      app = await bootApp();
      await app.go('/reglages', 'Mode vacances');
    });

    it('le bouton attend une date de retour', () => {
      expect(app.find('button.ton', 'Décaler')!.hasAttribute('disabled')).toBe(true);
    });

    it('décale les tâches en retard et le dit', async () => {
      app.type(app.find('input[type=date]'), '2099-01-01');
      app.press('button.ton', 'Décaler');
      await vi.waitFor(() =>
        expect(message()).toMatch(/2 tâches décalées au .* — bonnes vacances/),
      );
      expect((await app.db.tasks.get('t1'))?.nextDue).toBe('2099-01-01');
    });

    it('prévient quand rien n’est à décaler', async () => {
      await app.db.tasks.clear();
      app.type(app.find('input[type=date]'), '2099-01-01');
      app.press('button.ton', 'Décaler');
      await vi.waitFor(() => expect(message()).toBe('Aucune tâche à décaler.'));
    });

    it('accorde au singulier', async () => {
      await app.db.tasks.delete('t2');
      app.type(app.find('input[type=date]'), '2099-01-01');
      app.press('button.ton', 'Décaler');
      await vi.waitFor(() => expect(message()).toMatch(/^1 tâche décalée au/));
    });
  });

  describe('données', () => {
    it('télécharge la sauvegarde et mémorise la date', async () => {
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      expect(app.el().textContent).toContain('Dernière sauvegarde : jamais');
      app.press('button.fill', 'Exporter');
      await vi.waitFor(() => expect(message()).toBe('Sauvegarde téléchargée.'));
      expect(click).toHaveBeenCalled();
      expect(localStorage.getItem('lastBackup')).toBeTruthy();
      expect(app.el().textContent).not.toContain('Dernière sauvegarde : jamais');
    });

    it('écrit directement dans le fichier choisi quand le navigateur sait le faire', async () => {
      const chunks: Uint8Array[] = [];
      const out = {
        write: vi.fn(async (c: Uint8Array) => void chunks.push(c)),
        close: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      };
      const picker = vi.fn(async (_o: { suggestedName: string }) => ({
        createWritable: async () => out,
      }));
      (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = picker;
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      app.press('button.fill', 'Exporter');
      await vi.waitFor(() => expect(message()).toBe('Sauvegarde téléchargée.'));
      expect(picker.mock.calls[0][0].suggestedName).toMatch(/^my-aquarium-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(out.close).toHaveBeenCalled();
      expect(chunks.length).toBeGreaterThan(0);
      expect(click).not.toHaveBeenCalled();
    });

    it('ne fait rien si on ferme le choix du fichier', async () => {
      (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = async () => {
        throw new DOMException('annulé', 'AbortError');
      };
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      app.press('button.fill', 'Exporter');
      await app.flush();
      await vi.waitFor(() =>
        expect(app.find('button.fill', 'Exporter')!.hasAttribute('disabled')).toBe(false),
      );
      expect(localStorage.getItem('lastBackup')).toBeNull();
    });

    it('annule l’écriture et signale l’erreur si elle échoue en route', async () => {
      const out = {
        write: vi.fn(async () => {
          throw new Error('disque plein');
        }),
        close: vi.fn(),
        abort: vi.fn(async () => undefined),
      };
      (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = async () => ({
        createWritable: async () => out,
      });
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      app.press('button.fill', 'Exporter');
      await vi.waitFor(() => expect(message()).toBe('disque plein'));
      expect(out.abort).toHaveBeenCalled();
      expect(localStorage.getItem('lastBackup')).toBeNull();
    });

    it('restaure une sauvegarde valide', async () => {
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      const backup = {
        format: 'my-aquarium',
        version: 2,
        exportedAt: '',
        data: {
          tanks: [
            {
              id: 'z',
              updatedAt: '',
              name: 'Restauré',
              type: 'planted',
              volumeGross: 10,
              startDate: '2026-01-01',
              co2: false,
              archived: false,
            },
          ],
        },
      };
      pick(app.el().querySelector('input[type=file]')!, file(JSON.stringify(backup)));
      await vi.waitFor(() => expect(message()).toBe('Données importées.'));
      expect((await app.db.tanks.toArray()).map((t) => t.name)).toEqual(['Restauré']);
    });

    it('explique pourquoi un fichier est refusé', async () => {
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      pick(app.el().querySelector('input[type=file]')!, file('{"pas":"une sauvegarde"}'));
      await vi.waitFor(() => expect(message()).toContain('pas une sauvegarde'));
      expect(await app.db.tanks.count()).toBe(2);
    });

    it('n’importe rien si on refuse la confirmation', async () => {
      vi.stubGlobal('confirm', () => false);
      app = await bootApp();
      await app.go('/reglages', 'Dernière sauvegarde');
      pick(app.el().querySelector('input[type=file]')!, file('{}'));
      await app.flush();
      expect(message()).toBeUndefined();
      expect(await app.db.tanks.count()).toBe(2);
    });

    it('indique l’état de la protection du stockage et permet de réessayer', async () => {
      const persist = vi.fn(async () => false);
      vi.stubGlobal('navigator', {
        ...navigator,
        storage: {
          persisted: async () => false,
          persist,
          estimate: async () => ({ usage: 2 * 1024 * 1024, quota: 1e9 }),
        },
      });
      app = await bootApp();
      await app.go('/reglages', 'Stockage non protégé');
      expect(app.el().textContent).toContain('Espace utilisé : 2,0 Mo');
      persist.mockResolvedValue(true);
      app.press('button.linkbtn', 'réessaie');
      await vi.waitFor(() => expect(app.el().textContent).toContain('Stockage protégé'));
    });
  });
});

describe('BackupService', () => {
  async function service(today = '2026-10-27') {
    app = await bootApp();
    const store = TestBed.inject(AquariumStore);
    await app.until(() => store.ready() && store.tanks().length === 2);
    vi.spyOn(store, 'today').mockReturnValue(today);
    return TestBed.inject(BackupService);
  }

  it('rappelle une sauvegarde quand il y a des données et aucune sauvegarde', async () => {
    const s = await service();
    expect(s.daysSince()).toBeNull();
    expect(s.reminderDue()).toBe(true);
  });

  it('ne rappelle pas une sauvegarde récente, puis rappelle passé le délai', async () => {
    localStorage.setItem('lastBackup', '2026-10-20T10:00:00.000Z');
    const s = await service('2026-10-27');
    expect(s.daysSince()).toBe(7);
    expect(s.reminderDue()).toBe(false);
    localStorage.setItem('lastBackup', `2026-10-${27 - BACKUP_REMINDER_DAYS}T10:00:00.000Z`);
    const s2 = TestBed.runInInjectionContext(() => new BackupService());
    expect(s2.reminderDue()).toBe(true);
  });

  it('« plus tard » retarde le rappel de trois jours', async () => {
    const s = await service();
    s.snooze();
    expect(s.reminderDue()).toBe(false);
    const snooze = localStorage.getItem('backupSnooze')!;
    const expected = new Date();
    expected.setDate(expected.getDate() + 3);
    expect(snooze).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`,
    );
  });

  it('ne rappelle rien sans bac', async () => {
    app = await bootApp(async () => undefined);
    await app.until(() => TestBed.inject(AquariumStore).ready());
    expect(TestBed.inject(BackupService).reminderDue()).toBe(false);
  });

  it('une persistance refusée ou indisponible ne casse rien', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      storage: {
        persisted: async () => {
          throw new Error('x');
        },
        persist: async () => false,
      },
    });
    const s = await service();
    await vi.waitFor(() => expect(s.persisted()).toBeNull());
    await s.requestPersist();
    expect(s.persisted()).toBe(false);
  });
});

describe('fmtBytes', () => {
  it('choisit l’unité lisible', () => {
    expect(fmtBytes(512)).toBe('1 Ko');
    expect(fmtBytes(2048)).toBe('2 Ko');
    expect(fmtBytes(1024 * 1024)).toBe('1,0 Mo');
    expect(fmtBytes(1536 * 1024)).toBe('1,5 Mo');
    expect(fmtBytes(3 * 1024 ** 3)).toBe('3,0 Go');
    expect(fmtBytes(1024 * 1024 - 1)).toBe('1024 Ko');
  });

  describe('compte', () => {
    const API = 'https://api.exemple.test';
    const me = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'alice@exemple.fr',
      role: 'user',
      createdAt: '2026-10-28T10:00:00.000Z',
    };
    const device = (over = {}) => ({
      id: 'd1',
      device: 'Firefox sur Linux',
      createdAt: '2026-10-28T10:00:00.000Z',
      lastUsedAt: '2026-10-28T11:00:00.000Z',
      current: true,
      ...over,
    });

    function serveur(routes: Record<string, { status: number; body?: unknown }>) {
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${url.replace(API, '')}`;
        const r = routes[key] ?? { status: 500 };
        return Promise.resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: () => Promise.resolve(r.body),
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function ouverts() {
      TestBed.overrideProvider(API_URL, { useValue: API });
      TestBed.overrideProvider(ACCOUNTS_ENABLED, { useValue: true });
    }

    it('est absent quand les comptes sont fermés', async () => {
      TestBed.overrideProvider(ACCOUNTS_ENABLED, { useValue: false });
      app = await bootApp();
      await app.go('/reglages', 'Catalogue en ligne');
      expect(app.el().textContent).not.toContain('Compte');
      expect(app.find('a[href="/connexion"]')).toBeNull();
      expect(app.find('a[href="/confidentialite"]')).toBeNull();
    });

    it('propose de se connecter, sans obliger, et mène aux textes légaux', async () => {
      ouverts();
      app = await bootApp();
      await app.go('/reglages', 'Se connecter');
      expect(app.find('a[href="/connexion"]')).not.toBeNull();
      expect(app.el().textContent).toContain('marche très bien sans compte');
      const legal = ['/mentions-legales', '/confidentialite', '/conditions'];
      for (const href of legal) expect(app.find(`a[href="${href}"]`)).not.toBeNull();
    });

    it('affiche le compte et les appareils, et déconnecte un autre appareil', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      let appareils = [
        device(),
        device({ id: 'd2', device: 'Chrome sur Android', current: false }),
      ];
      const fetchMock = serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
      });
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${url.replace(API, '')}`;
        if (key === 'POST /auth/refresh')
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ accessToken: 'jeton', expiresIn: 900, user: me }),
          });
        if (key === 'DELETE /me/sessions/d2') appareils = [appareils[0]];
        return Promise.resolve({
          ok: true,
          status: key.startsWith('DELETE') ? 204 : 200,
          json: () => Promise.resolve({ items: appareils }),
        });
      });
      app = await bootApp();
      await app.go('/reglages', 'alice@exemple.fr');
      await app.until(() => app.el().textContent.includes('Chrome sur Android'));
      expect(app.el().textContent).toContain('Firefox sur Linux (cet appareil)');
      expect(app.find('button', 'Déconnecter')).not.toBeNull();
      app.press('button', 'Déconnecter');
      await app.until(() => !app.el().textContent.includes('Chrome sur Android'));
      expect(fetchMock.mock.calls.some((c) => c[0] === `${API}/me/sessions/d2`)).toBe(true);
    });

    it('supprime le compte après confirmation, et rien si on annule', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      const fetchMock = serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
        'GET /me/sessions': { status: 200, body: { items: [device()] } },
        'DELETE /me': { status: 204 },
      });
      const asked = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      vi.stubGlobal('confirm', asked);
      app = await bootApp();
      await app.go('/reglages', 'alice@exemple.fr');
      const deletions = () => fetchMock.mock.calls.filter((c) => c[0] === `${API}/me`).length;

      app.press('button', 'Supprimer');
      await app.flush();
      expect(asked.mock.calls[0]?.[0]).toContain('alice@exemple.fr');
      expect(asked.mock.calls[0]?.[0]).toContain('irréversible');
      expect(deletions()).toBe(0);

      app.press('button', 'Supprimer');
      await app.until(() => app.find('a[href="/connexion"]') !== null);
      expect(deletions()).toBe(1);
      expect(app.find('.msg')?.textContent).toContain('Compte supprimé');
    });

    it('signale une suppression impossible et garde le compte', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
        'GET /me/sessions': { status: 200, body: { items: [device()] } },
        'DELETE /me': { status: 500 },
      });
      vi.stubGlobal('confirm', () => true);
      app = await bootApp();
      await app.go('/reglages', 'alice@exemple.fr');
      app.press('button', 'Supprimer');
      await app.until(() => app.find('.msg')?.textContent.includes('impossible') === true);
      expect(app.find('.msg')?.textContent).toContain('Suppression impossible');
      expect(TestBed.inject(AuthService).user()).not.toBeNull();
    });

    it('montre l’état de la synchronisation et permet de la relancer', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      const fetchMock = serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
        'GET /me/sessions': { status: 200, body: { items: [device()] } },
        'POST /sync/push': { status: 200, body: { accepted: 1, ignored: 0 } },
        'GET /sync/pull?after=0': { status: 200, body: { changes: [], cursor: 0, more: false } },
      });
      app = await bootApp();
      await app.go('/reglages', 'Synchronisation');
      await app.until(() => app.el().textContent.includes('À jour'));
      const pulls = () =>
        fetchMock.mock.calls.filter((c) => c[0].startsWith(`${API}/sync/pull`)).length;
      const before = pulls();
      app.press('button', 'Synchroniser maintenant');
      await app.until(() => pulls() === before + 1);
    });

    it('signale un serveur qui ne répond pas, avec les modifications en attente', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
        'GET /me/sessions': { status: 200, body: { items: [device()] } },
      });
      app = await bootApp();
      await app.go('/reglages', 'Synchronisation');
      // Le compteur d’attente se met à jour juste après le message d’erreur.
      await app.until(
        () =>
          app.el().textContent.includes('n’a pas répondu') &&
          /[1-9]\d* modifications? en attente/.test(app.el().textContent),
      );
    });

    it('propose les rappels même appli fermée quand on est connecté avec les rappels activés', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
        'GET /me/sessions': { status: 200, body: { items: [device()] } },
        'GET /push/key': { status: 200, body: { publicKey: 'AQAB' } },
      });
      vi.stubGlobal('PushManager', class {});
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: new Promise(() => undefined),
          getRegistration: () => Promise.resolve(undefined),
        },
        configurable: true,
      });
      try {
        app = await bootApp();
        await app.db.prefs.put({ ...DEFAULT_PREFS, enabled: true, time: '08:30' });
        await app.go('/reglages', 'Même appli fermée');
        expect(app.el().textContent).toContain('Envoyés par le serveur');
        const push = TestBed.inject(PushService);
        const enable = vi.spyOn(push, 'enable').mockResolvedValue();
        const toggle = [...app.el().querySelectorAll<HTMLInputElement>('input[role=switch]')].find(
          (i) => i.parentElement?.textContent.includes('même appli fermée'),
        );
        if (!toggle) throw new Error('interrupteur absent');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        await app.flush();
        expect(enable).toHaveBeenCalled();
        // Activé : l'abonnement démarre (le service worker simulé ne répond jamais).
        push.enabled.set(true);
        await app.until(() => app.el().textContent.includes('Activation…'));
        push.state.set('on');
        await app.until(() => app.el().textContent.includes('le rappel arrive vers 08:30'));
      } finally {
        delete (navigator as unknown as Record<string, unknown>)['serviceWorker'];
      }
    });

    it('se déconnecte', async () => {
      ouverts();
      localStorage.setItem('signedIn', '1');
      serveur({
        'POST /auth/refresh': {
          status: 200,
          body: { accessToken: 'jeton', expiresIn: 900, user: me },
        },
        'GET /me/sessions': { status: 200, body: { items: [device()] } },
        'POST /auth/logout': { status: 204 },
      });
      app = await bootApp();
      await app.go('/reglages', 'alice@exemple.fr');
      app.press('button', 'Se déconnecter');
      await app.until(() => app.find('a[href="/connexion"]') !== null);
      expect(TestBed.inject(AuthService).user()).toBeNull();
    });
  });

  describe('détails techniques', () => {
    it('résume l’état et les derniers échanges, et se copie', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      app = await bootApp();
      await app.go('/reglages', 'Détails techniques');
      TestBed.inject(DiagLog).record('GET /sync/pull', '500');
      const details = app.find('details.diag') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      await app.until(() => app.find('.diag pre')?.textContent.includes('GET /sync/pull') === true);
      const text = app.find('.diag pre')?.textContent ?? '';
      expect(text).toContain('Connecté : non');
      expect(text).toContain('Synchronisation : off');
      expect(text).toContain('Curseur : aucun');
      app.press('.diag button', 'Copier');
      await app.until(() => app.el().textContent.includes('Copié'));
      expect(writeText).toHaveBeenCalledWith(text);
    });

    it('propose de sélectionner à la main si la copie est refusée', async () => {
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: { writeText: () => Promise.reject(new Error('refus')) },
      });
      app = await bootApp();
      await app.go('/reglages', 'Détails techniques');
      app.press('.diag button', 'Copier');
      await app.until(() => app.el().textContent.includes('Copie impossible'));
    });
  });
});
