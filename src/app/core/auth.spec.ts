import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTS_ENABLED, API_URL } from './api-config';
import { AuthService } from './auth';

const API = 'https://api.exemple.test';
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alice@exemple.fr',
  role: 'user',
  createdAt: '2026-10-28T10:00:00.000Z',
};
const session = (accessToken = 'jeton-1', expiresIn = 900) => ({ accessToken, expiresIn, user });
const device = (over = {}) => ({
  id: 'd1',
  device: 'Firefox',
  createdAt: '2026-10-28T10:00:00.000Z',
  lastUsedAt: '2026-10-28T11:00:00.000Z',
  current: true,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

const reply = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

function service(opts: { url?: string | null; enabled?: boolean; signedIn?: boolean } = {}) {
  localStorage.clear();
  if (opts.signedIn) localStorage.setItem('signedIn', '1');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: API_URL, useValue: opts.url === undefined ? API : opts.url },
      { provide: ACCOUNTS_ENABLED, useValue: opts.enabled ?? true },
    ],
  });
  return TestBed.inject(AuthService);
}

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AuthService', () => {
  describe('disponibilité', () => {
    it('est indisponible sans adresse d’API ou tant que les comptes sont fermés', () => {
      expect(service({ url: null }).available).toBe(false);
      expect(service({ enabled: false }).available).toBe(false);
      expect(service().available).toBe(true);
    });

    it('suit la configuration de l’appli publiée', () => {
      TestBed.resetTestingModule();
      expect(TestBed.inject(AuthService).available).toBe(
        TestBed.inject(API_URL) !== null && TestBed.inject(ACCOUNTS_ENABLED),
      );
    });

    it('ne contacte jamais le serveur quand c’est indisponible', async () => {
      const auth = service({ enabled: false, signedIn: true });
      await auth.restore();
      expect(await auth.requestLink('a@exemple.fr')).toBe('error');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reprise de session', () => {
    it('ne demande rien à un appareil qui ne s’est jamais connecté', async () => {
      await service().restore();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renouvelle la session avec le cookie et garde le jeton en mémoire seulement', async () => {
      const auth = service({ signedIn: true });
      reply(200, session('jeton-secret'));
      await auth.restore();
      const { url, init } = lastCall();
      expect(url).toBe(`${API}/auth/refresh`);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(auth.user()?.email).toBe('alice@exemple.fr');
      expect(JSON.stringify({ ...localStorage })).not.toContain('jeton-secret');
      expect(JSON.stringify({ ...sessionStorage })).not.toContain('jeton-secret');
    });

    it('oublie la connexion quand le serveur la refuse', async () => {
      const auth = service({ signedIn: true });
      reply(401, {});
      await auth.restore();
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('0');
    });

    it('reste connecté localement quand le serveur est injoignable ou répond mal', async () => {
      const auth = service({ signedIn: true });
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.restore();
      reply(500, {});
      await auth.restore();
      reply(200, { accessToken: 1 });
      await auth.restore();
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('1');
    });

    it('regroupe les renouvellements simultanés en une seule requête', async () => {
      const auth = service({ signedIn: true });
      reply(200, session());
      await Promise.all([auth.restore(), auth.restore()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('prend un verrou du navigateur quand il existe, pour les autres onglets', async () => {
      const request = vi.fn((_name: string, cb: () => Promise<boolean>) => cb());
      vi.stubGlobal('navigator', { ...navigator, locks: { request } });
      const auth = service({ signedIn: true });
      reply(200, session());
      await auth.restore();
      expect(request).toHaveBeenCalledWith('aquarium-auth-refresh', expect.any(Function));
      expect(auth.user()).not.toBeNull();
    });
  });

  describe('lien de connexion', () => {
    it.each([
      [204, 'sent'],
      [400, 'invalid'],
      [429, 'limited'],
      [503, 'unavailable'],
      [500, 'error'],
    ])('la réponse %i donne « %s »', async (status, expected) => {
      const auth = service();
      reply(status);
      expect(await auth.requestLink('a@exemple.fr')).toBe(expected);
      const { url, init, headers } = lastCall();
      expect(url).toBe(`${API}/auth/magic-link`);
      expect(init.body).toBe(JSON.stringify({ email: 'a@exemple.fr' }));
      expect(headers['content-type']).toBe('application/json');
    });

    it('signale un serveur injoignable', async () => {
      const auth = service();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await auth.requestLink('a@exemple.fr')).toBe('error');
    });
  });

  describe('vérification du lien', () => {
    it('ouvre la session', async () => {
      const auth = service();
      reply(200, session());
      expect(await auth.verify('lien')).toBe('ok');
      expect(lastCall().init.body).toBe(JSON.stringify({ token: 'lien' }));
      expect(auth.user()?.id).toBe(user.id);
      expect(localStorage.getItem('signedIn')).toBe('1');
    });

    it('transmet le consentement quand il est donné', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien', { terms: true, age15: true });
      expect(JSON.parse(lastCall().init.body as string)).toEqual({
        token: 'lien',
        consent: { terms: true, age15: true },
      });
    });

    it.each([
      [409, 'consent_required'],
      [400, 'invalid'],
      [500, 'error'],
    ])('la réponse %i donne « %s »', async (status, expected) => {
      const auth = service();
      reply(status, {});
      expect(await auth.verify('lien')).toBe(expected);
      expect(auth.user()).toBeNull();
    });

    it('refuse une réponse mal formée ou un réseau absent', async () => {
      const auth = service();
      reply(200, { accessToken: 'x' });
      expect(await auth.verify('lien')).toBe('error');
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await auth.verify('lien')).toBe('error');
      expect(auth.user()).toBeNull();
    });

    it('refuse un compte au rôle inconnu', async () => {
      const auth = service();
      reply(200, { ...session(), user: { ...user, role: 'root' } });
      expect(await auth.verify('lien')).toBe('error');
    });
  });

  describe('déconnexion', () => {
    it('ferme la session côté serveur et localement', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien');
      reply(204);
      await auth.logout();
      expect(lastCall().url).toBe(`${API}/auth/logout`);
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('0');
    });

    it('ferme quand même la session locale hors ligne', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien');
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.logout();
      expect(auth.user()).toBeNull();
    });
  });

  describe('appareils connectés', () => {
    async function signedIn() {
      const auth = service();
      reply(200, session('jeton-A'));
      await auth.verify('lien');
      return auth;
    }

    it('liste les appareils avec le jeton d’accès, en ignorant les lignes mal formées', async () => {
      const auth = await signedIn();
      reply(200, { items: [device(), { id: 5 }] });
      await auth.loadDevices();
      const { url, headers } = lastCall();
      expect(url).toBe(`${API}/me/sessions`);
      expect(headers['authorization']).toBe('Bearer jeton-A');
      expect(auth.devices()).toEqual([device()]);
    });

    it('ignore une liste absente ou une erreur', async () => {
      const auth = await signedIn();
      reply(200, {});
      await auth.loadDevices();
      reply(500, {});
      await auth.loadDevices();
      expect(auth.devices()).toEqual([]);
    });

    it('renouvelle le jeton d’accès expiré avant d’appeler', async () => {
      const auth = service();
      reply(200, session('jeton-court', 1));
      await auth.verify('lien');
      reply(200, session('jeton-neuf'));
      reply(200, { items: [] });
      await auth.loadDevices();
      expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual([
        `${API}/auth/verify`,
        `${API}/auth/refresh`,
        `${API}/me/sessions`,
      ]);
      expect(lastCall().headers['authorization']).toBe('Bearer jeton-neuf');
    });

    it('réessaie une fois après un refus 401', async () => {
      const auth = await signedIn();
      reply(401, {});
      reply(200, session('jeton-B'));
      reply(200, { items: [device()] });
      await auth.loadDevices();
      expect(lastCall().headers['authorization']).toBe('Bearer jeton-B');
      expect(auth.devices()).toHaveLength(1);
    });

    it('ne fait rien sans connexion', async () => {
      const auth = service();
      reply(401, {});
      await auth.loadDevices();
      expect(auth.devices()).toEqual([]);
      expect(await auth.revokeDevice('d2')).toBe(false);
    });

    it('ne fait rien quand le réseau est coupé', async () => {
      const auth = await signedIn();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.loadDevices();
      expect(auth.devices()).toEqual([]);
    });

    it('déconnecte un autre appareil puis recharge la liste', async () => {
      const auth = await signedIn();
      reply(204);
      reply(200, { items: [device()] });
      expect(await auth.revokeDevice('d 2')).toBe(true);
      const calls = fetchMock.mock.calls as [string, RequestInit][];
      expect(calls[1]?.[0]).toBe(`${API}/me/sessions/d%202`);
      expect(calls[1]?.[1].method).toBe('DELETE');
      expect(auth.devices()).toHaveLength(1);
    });

    it('accepte un appareil déjà déconnecté (404) et signale les autres échecs', async () => {
      const auth = await signedIn();
      reply(404, {});
      reply(200, { items: [] });
      expect(await auth.revokeDevice('d2')).toBe(true);
      reply(500, {});
      expect(await auth.revokeDevice('d2')).toBe(false);
    });
  });

  describe('contrôle des réponses du serveur', () => {
    /** Copie de l'objet sans l'un de ses champs. */
    const sansChamp = (obj: Record<string, unknown>, key: string) =>
      Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

    it.each([
      ['rien', null],
      ['un texte', 'texte'],
      ['un tableau vide', []],
      ['sans jeton', sansChamp(session(), 'accessToken')],
      ['sans durée', sansChamp(session(), 'expiresIn')],
      ['avec une durée en texte', { ...session(), expiresIn: '900' }],
      ['sans compte', sansChamp(session(), 'user')],
      ['avec un compte vide', { ...session(), user: null }],
      ['avec un compte sans identifiant', { ...session(), user: sansChamp(user, 'id') }],
      ['avec un compte sans e-mail', { ...session(), user: sansChamp(user, 'email') }],
      ['avec un compte sans date', { ...session(), user: sansChamp(user, 'createdAt') }],
      ['avec un compte sans rôle', { ...session(), user: sansChamp(user, 'role') }],
      ['avec un rôle vide', { ...session(), user: { ...user, role: '' } }],
    ])('refuse une connexion %s', async (_nom, corps) => {
      const auth = service();
      reply(200, corps);
      expect(await auth.verify('lien')).toBe('error');
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBeNull();
    });

    it.each([
      ['rien', null],
      ['un texte', 'texte'],
      ['sans identifiant', sansChamp(device(), 'id')],
      ['sans nom', sansChamp(device(), 'device')],
      ['sans création', sansChamp(device(), 'createdAt')],
      ['sans dernière utilisation', sansChamp(device(), 'lastUsedAt')],
      ['sans indicateur', sansChamp(device(), 'current')],
      ['avec un indicateur en texte', device({ current: 'oui' })],
    ])('ignore un appareil %s', async (_nom, ligne) => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien');
      reply(200, { items: [ligne, device()] });
      await auth.loadDevices();
      expect(auth.devices()).toEqual([device()]);
    });

    it('n’ouvre pas de session sur une réponse en erreur, même bien formée', async () => {
      const auth = service();
      reply(500, session());
      expect(await auth.verify('lien')).toBe('error');
      expect(auth.user()).toBeNull();
    });

    it('ne reprend pas la session sur une réponse en erreur, même bien formée', async () => {
      const auth = service({ signedIn: true });
      reply(500, session());
      await auth.restore();
      expect(auth.user()).toBeNull();
    });

    it('n’appelle pas la liste des appareils quand le renouvellement échoue', async () => {
      const auth = service();
      reply(200, session('jeton-court', 1));
      await auth.verify('lien');
      reply(500, session());
      await auth.loadDevices();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      reply(200, { accessToken: 1 });
      await auth.loadDevices();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await auth.loadDevices();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('refait un renouvellement à chaque fois (pas de réutilisation d’un ancien)', async () => {
      const auth = service({ signedIn: true });
      reply(200, session('jeton-1'));
      await auth.restore();
      reply(200, session('jeton-2'));
      await auth.restore();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('forme des requêtes', () => {
    it('demande en JSON, et n’envoie le type du corps et le jeton que quand il y en a', async () => {
      const auth = service();
      reply(204);
      await auth.requestLink('a@exemple.fr');
      const premiere = lastCall();
      expect(premiere.init.method).toBe('POST');
      expect(premiere.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
      });

      reply(200, session('jeton-A'));
      await auth.verify('lien');
      reply(204);
      await auth.logout();
      const sortie = lastCall();
      expect(sortie.init.method).toBe('POST');
      expect(sortie.init.body).toBeUndefined();
      expect(sortie.headers).toEqual({ accept: 'application/json' });

      const auth2 = service();
      reply(200, session('jeton-B'));
      await auth2.verify('lien');
      reply(200, { items: [] });
      await auth2.loadDevices();
      const liste = lastCall();
      expect(liste.init.method).toBe('GET');
      expect(liste.init.body).toBeUndefined();
      expect(liste.headers).toEqual({
        accept: 'application/json',
        authorization: 'Bearer jeton-B',
      });
    });

    it('renouvelle pile à l’approche de l’expiration, pas avant', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const auth = service();
        reply(200, session('jeton-1', 100));
        await auth.verify('lien');
        reply(200, { items: [] });
        vi.setSystemTime(Date.now() + 69_000);
        await auth.loadDevices();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        reply(200, session('jeton-2', 100));
        reply(200, { items: [] });
        vi.setSystemTime(Date.now() + 2_000);
        await auth.loadDevices();
        expect(fetchMock).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('suppression du compte', () => {
    it('supprime côté serveur puis ferme la session locale', async () => {
      const auth = service();
      reply(200, session('jeton-A'));
      await auth.verify('lien');
      reply(204);
      expect(await auth.deleteAccount()).toBe(true);
      const { url, init, headers } = lastCall();
      expect(url).toBe(`${API}/me`);
      expect(init.method).toBe('DELETE');
      expect(headers['authorization']).toBe('Bearer jeton-A');
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('0');
    });

    it('garde la session quand le serveur refuse ou ne répond pas', async () => {
      const auth = service();
      reply(200, session());
      await auth.verify('lien');
      reply(500, {});
      expect(await auth.deleteAccount()).toBe(false);
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await auth.deleteAccount()).toBe(false);
      expect(auth.user()).not.toBeNull();
    });

    it('échoue sans connexion', async () => {
      const auth = service();
      reply(401, {});
      expect(await auth.deleteAccount()).toBe(false);
    });
  });

  describe('déconnexion pendant un renouvellement', () => {
    it('ne se reconnecte pas quand la réponse arrive après la déconnexion', async () => {
      const auth = service({ signedIn: true });
      let answer: (v: unknown) => void = () => undefined;
      const late = new Promise((resolve) => {
        answer = resolve;
      });
      fetchMock.mockReturnValueOnce(late);
      const restoring = auth.restore();
      reply(204);
      await auth.logout();
      answer({ ok: true, status: 200, json: () => Promise.resolve(session()) });
      await restoring;
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('signedIn')).toBe('0');
    });
  });
});
