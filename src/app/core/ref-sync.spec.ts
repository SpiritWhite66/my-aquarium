import { TestBed } from '@angular/core/testing';
import type { RefSpecies } from '@aquarium/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from './api-config';
import { BUILTIN_SPECIES } from './catalog';
import { AQUARIUM_DB, AquariumDb } from './db';
import { useFakeIndexedDb } from './fake-db.testing';
import { RefSyncService } from './ref-sync';

const URL_API = 'https://api.exemple.test';
const NEW = '2027-01-01T10:00:00.000Z';

const fiche = (over: Partial<RefSpecies> = {}): RefSpecies => ({
  id: 'espece-serveur',
  kind: 'fish',
  scientificName: 'Serveur specius',
  commonNames: ['Poisson du serveur'],
  updatedAt: NEW,
  deletedAt: null,
  ...over,
});

let db: AquariumDb;
let fetchMock: ReturnType<typeof vi.fn>;

function reply(items: unknown, init: { ok?: boolean; status?: number } = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve({ items }),
  });
}

function service(url: string | null = URL_API, flag?: string): RefSyncService {
  localStorage.clear();
  if (flag) localStorage.setItem('onlineCatalog', flag);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AQUARIUM_DB, useValue: db },
      { provide: API_URL, useValue: url },
    ],
  });
  return TestBed.inject(RefSyncService);
}

beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb('test');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  db.close();
  await db.delete();
});

describe('interrupteur', () => {
  it('est désactivé par défaut', () => {
    expect(service().enabled()).toBe(false);
  });

  it('se souvient du choix sur l’appareil', () => {
    expect(service(URL_API, '1').enabled()).toBe(true);
    expect(service(URL_API, '0').enabled()).toBe(false);
  });

  it('reste désactivé et indisponible sans adresse d’API', () => {
    expect(service(null, '1').enabled()).toBe(false);
    const s = service(null);
    expect(s.available).toBe(false);
    expect(s.enabled()).toBe(false);
    s.setEnabled(true);
    expect(s.enabled()).toBe(false);
    expect(localStorage.getItem('onlineCatalog')).toBeNull();
  });

  it('l’activer mémorise le choix et lance une synchronisation', async () => {
    const s = service();
    reply([fiche()]);
    s.setEnabled(true);
    expect(localStorage.getItem('onlineCatalog')).toBe('1');
    await vi.waitFor(() => expect(s.status()).toBe('ok'));
    s.setEnabled(false);
    expect(localStorage.getItem('onlineCatalog')).toBe('0');
  });
});

describe('désactivé : fonctionnement d’origine', () => {
  it('le catalogue intégré écrase la base à chaque démarrage', async () => {
    const s = service();
    const first = BUILTIN_SPECIES[0];
    await db.species.put({ ...first, notes: 'modifiée' });
    await s.seedCatalog();
    expect((await db.species.get(first.id))?.notes).toBe(first.notes);
    expect(await db.species.count()).toBe(BUILTIN_SPECIES.length);
  });

  it('ne contacte jamais le serveur', async () => {
    const s = service();
    await s.sync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.status()).toBe('idle');
  });
});

describe('activé', () => {
  it('première synchronisation : catalogue intégré puis fiches du serveur, sans `since`', async () => {
    const s = service(URL_API, '1');
    await s.seedCatalog();
    reply([fiche()]);
    await s.sync();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${URL_API}/ref/species`);
    expect(s.status()).toBe('ok');
    expect(await db.species.get('espece-serveur')).toMatchObject({
      scientificName: 'Serveur specius',
      source: 'builtin',
      updatedAt: NEW,
    });
    expect(await db.species.count()).toBe(BUILTIN_SPECIES.length + 1);
    expect((await db.refMeta.get('species'))?.since).toBe(NEW);
  });

  it('les synchronisations suivantes reprennent à `since`', async () => {
    const s = service(URL_API, '1');
    reply([fiche()]);
    await s.sync();
    reply([]);
    await s.sync();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${URL_API}/ref/species?since=${encodeURIComponent(NEW)}`,
    );
    expect((await db.refMeta.get('species'))?.since).toBe(NEW);
  });

  it('une fiche du serveur plus récente que celle de l’appli la remplace', async () => {
    const s = service(URL_API, '1');
    const first = BUILTIN_SPECIES[0];
    await s.seedCatalog();
    reply([
      fiche({ id: first.id, scientificName: first.scientificName, notes: 'Notes du serveur' }),
    ]);
    await s.sync();
    expect((await db.species.get(first.id))?.notes).toBe('Notes du serveur');
  });

  it('le catalogue intégré n’écrase pas une fiche plus récente à la première activation', async () => {
    const s = service(URL_API, '1');
    const first = BUILTIN_SPECIES[0];
    await db.species.put({ ...first, updatedAt: NEW, notes: 'plus récente' });
    await s.seedCatalog();
    expect((await db.species.get(first.id))?.notes).toBe('plus récente');
  });

  it('une fois synchronisé, le serveur fait foi : une fiche retirée ne revient pas', async () => {
    const s = service(URL_API, '1');
    const first = BUILTIN_SPECIES[0];
    await s.seedCatalog();
    reply([{ ...fiche({ id: first.id, scientificName: first.scientificName, deletedAt: NEW }) }]);
    await s.sync();
    expect(await db.species.get(first.id)).toBeUndefined();
    await s.seedCatalog();
    expect(await db.species.get(first.id)).toBeUndefined();
  });

  it('garde une fiche retirée du serveur tant qu’un habitant l’utilise', async () => {
    const s = service(URL_API, '1');
    await s.seedCatalog();
    const first = BUILTIN_SPECIES[0];
    await db.inhabitants.put({
      id: 'h1',
      updatedAt: NEW,
      tankId: 't',
      speciesId: first.id,
      quantity: 3,
    } as never);
    reply([fiche({ id: first.id, scientificName: first.scientificName, deletedAt: NEW })]);
    await s.sync();
    expect(await db.species.get(first.id)).toBeDefined();
  });

  it('ignore les fiches mal formées sans rejeter les bonnes', async () => {
    const s = service(URL_API, '1');
    reply([fiche(), { id: 12 }, null, 'texte', fiche({ id: 'autre', kind: 'dragon' as never })]);
    await s.sync();
    expect(s.status()).toBe('ok');
    expect(await db.species.toArray().then((l) => l.map((x) => x.id))).toEqual(['espece-serveur']);
  });

  it.each([
    ['une réponse d’erreur', () => fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })],
    ['une panne réseau', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
    [
      'un corps inattendu',
      () =>
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    ],
  ])('%s : état « error » et catalogue local intact', async (_nom, arrange) => {
    const s = service(URL_API, '1');
    await s.seedCatalog();
    arrange();
    await s.sync();
    expect(s.status()).toBe('error');
    expect(await db.species.count()).toBe(BUILTIN_SPECIES.length);
    expect(await db.refMeta.get('species')).toBeUndefined();
  });

  it('ne lance pas deux synchronisations en même temps', async () => {
    const s = service(URL_API, '1');
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = s.sync();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(s.status()).toBe('syncing');
    await s.sync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });
    await first;
    expect(s.status()).toBe('ok');
  });
});
