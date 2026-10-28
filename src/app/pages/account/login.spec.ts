import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTS_ENABLED, API_URL } from '../../core/api-config';
import { bootApp, closeApp, type App } from '../../testing/app.testing';

const API = 'https://api.exemple.test';
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alice@exemple.fr',
  role: 'user',
  createdAt: '2026-10-28T10:00:00.000Z',
};
const session = { accessToken: 'jeton', expiresIn: 900, user };

let app: App;
let fetchMock: ReturnType<typeof vi.fn>;

const reply = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
const paths = () => fetchMock.mock.calls.map((c) => (c[0] as string).replace(API, ''));

async function boot(open = true) {
  TestBed.overrideProvider(API_URL, { useValue: API });
  TestBed.overrideProvider(ACCOUNTS_ENABLED, { useValue: open });
  app = await bootApp();
}

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await closeApp(app);
  vi.unstubAllGlobals();
});

describe('connexion', () => {
  it('annonce que les comptes ne sont pas ouverts, sans rien demander au réseau', async () => {
    await boot(false);
    await app.go('/connexion', 'pas encore ouverts');
    expect(app.find('form')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envoie le lien par e-mail puis invite à consulter sa boîte', async () => {
    await boot();
    await app.go('/connexion', 'Recevoir un lien');
    expect(app.find('button[type=submit]')?.hasAttribute('disabled')).toBe(true);
    app.type(app.find('#email'), 'alice@exemple.fr');
    reply(204);
    app.press('button[type=submit]');
    await app.until(() => app.el().textContent.includes('Consulte tes e-mails'));
    expect(paths()).toEqual(['/auth/magic-link']);
    expect(
      JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string),
    ).toEqual({
      email: 'alice@exemple.fr',
    });
    app.press('button', 'autre adresse');
    await app.until(() => app.find('#email') !== null);
  });

  it.each([
    [400, 'ne semble pas valide'],
    [429, 'Trop de demandes'],
    [503, 'pas disponible'],
    [500, 'ne répond pas'],
  ])('affiche un message clair pour la réponse %i', async (status, text) => {
    await boot();
    await app.go('/connexion', 'Recevoir un lien');
    app.type(app.find('#email'), 'alice@exemple.fr');
    reply(status);
    app.press('button[type=submit]');
    await app.until(() => app.find('[role=alert]')?.textContent.includes(text) === true);
    expect(app.find('#email')).not.toBeNull();
  });

  it('ouvre la session avec le lien reçu puis retire le lien de l’adresse', async () => {
    await boot();
    reply(200, session);
    reply(200, { items: [] });
    await app.go('/connexion?token=lien-recu-par-email-0123456789');
    const router = TestBed.inject(Router);
    await app.until(() => router.url === '/reglages');
    expect(paths()[0]).toBe('/auth/verify');
    expect(router.url).not.toContain('token');
    await app.until(() => app.el().textContent.includes('alice@exemple.fr'));
  });

  it('demande les consentements à l’inscription, puis réutilise le même lien', async () => {
    await boot();
    reply(409, {});
    await app.go('/connexion?token=lien-recu-par-email-0123456789', 'Créer mon compte');
    const create = () => app.find('button.fill') as HTMLButtonElement;
    expect(create().disabled).toBe(true);
    const [terms, age] = [...app.el().querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    terms.checked = true;
    terms.dispatchEvent(new Event('change'));
    await app.flush();
    expect(create().disabled).toBe(true);
    age.checked = true;
    age.dispatchEvent(new Event('change'));
    await app.until(() => !create().disabled);
    reply(200, session);
    reply(200, { items: [] });
    app.click(create());
    await app.until(() => TestBed.inject(Router).url === '/reglages');
    const body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.consent).toEqual({ terms: true, age15: true });
  });

  it('propose un nouveau lien quand celui-ci est périmé', async () => {
    await boot();
    reply(400, {});
    await app.go('/connexion?token=lien-recu-par-email-0123456789', 'plus valable');
    expect(app.find('a', 'nouveau lien')?.getAttribute('href')).toBe('/connexion');
  });

  it('revient au formulaire avec un message si le serveur ne répond pas', async () => {
    await boot();
    reply(500, {});
    await app.go('/connexion?token=lien-recu-par-email-0123456789', 'Recevoir un lien');
    expect(app.find('[role=alert]')?.textContent).toContain('ne répond pas');
  });

  it('ne revérifie pas deux fois le même lien', async () => {
    await boot();
    reply(400, {});
    await app.go('/connexion?token=lien-recu-par-email-0123456789', 'plus valable');
    await app.flush();
    expect(paths()).toEqual(['/auth/verify']);
  });

  it('indique à une personne déjà connectée son adresse', async () => {
    localStorage.setItem('signedIn', '1');
    await boot();
    reply(200, session);
    reply(200, { items: [] });
    const auth = (await import('../../core/auth')).AuthService;
    await TestBed.inject(auth).restore();
    await app.go('/connexion', 'Tu es connecté');
    expect(app.el().textContent).toContain('alice@exemple.fr');
  });
});
