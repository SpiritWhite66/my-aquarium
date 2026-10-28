import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SyncChange } from '@aquarium/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth';
import { AQUARIUM_DB, AquariumDb } from './db';
import { useFakeIndexedDb } from './fake-db.testing';
import type { Species, Tank } from './models';
import { SyncEngine, SyncService, type SyncRequest } from './sync';

/** Serveur simulé, mêmes règles que l'API : la date la plus récente gagne, curseur croissant. */
class FakeServer {
  rows = new Map<string, SyncChange & { seq: number }>();
  seq = 0;
  offline = false;
  failWith: number | null = null;
  pushes = 0;
  pulls = 0;
  /** Appelé à chaque requête, avant la réponse. */
  onRequest: () => void = () => undefined;

  request: SyncRequest = (path, init = {}) => {
    this.onRequest();
    if (this.offline) return Promise.resolve(null);
    const reply = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status < 300,
        status,
        json: () => Promise.resolve(structuredClone(body)),
      } as Response);
    if (this.failWith !== null) return reply(this.failWith, {});
    if (path === '/sync/push') {
      this.pushes += 1;
      const { changes } = structuredClone(init.body) as { changes: SyncChange[] };
      let accepted = 0;
      for (const c of changes) {
        const key = `${c.table}|${c.id}`;
        const old = this.rows.get(key);
        if (old && old.updatedAt >= c.updatedAt) continue;
        this.rows.set(key, { ...c, seq: ++this.seq });
        accepted += 1;
      }
      return reply(200, { accepted, ignored: changes.length - accepted });
    }
    this.pulls += 1;
    const after = Number(new URL(path, 'http://x').searchParams.get('after'));
    const list = [...this.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq);
    const page = list.slice(0, 2);
    return reply(200, {
      changes: page.map(({ seq: _seq, ...c }) => c),
      cursor: page.at(-1)?.seq ?? after,
      more: list.length > 2,
    });
  };
}

const U = '2026-10-01T10:00:00.000Z';
const tank = (id: string, name: string): Tank => ({
  id,
  updatedAt: U,
  name,
  type: 'planted',
  volumeGross: 60,
  startDate: '2026-01-01',
  co2: false,
  archived: false,
});
const species = (id: string, source: Species['source']): Species => ({
  id,
  updatedAt: U,
  kind: 'fish',
  scientificName: id,
  commonNames: [],
  source,
});

let n = 0;
let server: FakeServer;
let phone: AquariumDb;
let pc: AquariumDb;
const engine = (db: AquariumDb) => new SyncEngine(db, server.request);
const names = async (db: AquariumDb) => (await db.tanks.toArray()).map((t) => t.name).sort();

beforeEach(() => {
  useFakeIndexedDb();
  server = new FakeServer();
  phone = new AquariumDb(`phone-${String(n)}`);
  pc = new AquariumDb(`pc-${String(n++)}`);
});
afterEach(async () => {
  vi.useRealTimers();
  await phone.delete();
  await pc.delete();
});

describe('SyncEngine : deux appareils', () => {
  it('envoie les données d’un appareil et les retrouve sur l’autre', async () => {
    await phone.tanks.bulkPut([tank('a', 'Salon'), tank('b', 'Nano'), tank('c', 'Bureau')]);
    await engine(phone).run('u1');
    expect(await phone.outbox.count()).toBe(0);
    await engine(pc).run('u1');
    expect(await names(pc)).toEqual(['Bureau', 'Nano', 'Salon']);
    // Ce qui vient du serveur ne repart pas.
    expect(await pc.outbox.count()).toBe(0);
  });

  it('une modification faite hors ligne arrive sur l’autre appareil au retour du réseau', async () => {
    await phone.tanks.put(tank('a', 'Salon'));
    await engine(phone).run('u1');
    await engine(pc).run('u1');

    server.offline = true;
    await phone.tanks.update('a', { name: 'Salon modifié hors ligne' });
    await expect(engine(phone).run('u1')).rejects.toMatchObject({ reason: 'offline' });
    expect(await phone.outbox.count()).toBe(1);

    server.offline = false;
    await engine(phone).run('u1');
    await engine(pc).run('u1');
    expect(await names(pc)).toEqual(['Salon modifié hors ligne']);
  });

  it('propage les suppressions, y compris en cascade', async () => {
    await phone.tanks.bulkPut([tank('a', 'Salon'), tank('b', 'Nano')]);
    await engine(phone).run('u1');
    await engine(pc).run('u1');
    await phone.tanks.where('id').equals('a').delete();
    await engine(phone).run('u1');
    await engine(pc).run('u1');
    expect(await names(pc)).toEqual(['Nano']);
  });

  it('conflit : la modification la plus récente gagne sur les deux appareils', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    await phone.tanks.put(tank('a', 'Départ'));
    await engine(phone).run('u1');
    await engine(pc).run('u1');

    vi.setSystemTime(new Date('2026-10-01T11:00:00Z'));
    await phone.tanks.update('a', { name: 'Téléphone (11 h)' });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    await pc.tanks.update('a', { name: 'Ordinateur (12 h)' });

    // L'ordinateur synchronise d'abord, le téléphone ensuite : la version de 12 h reste.
    await engine(pc).run('u1');
    await engine(phone).run('u1');
    await engine(pc).run('u1');
    expect(await names(phone)).toEqual(['Ordinateur (12 h)']);
    expect(await names(pc)).toEqual(['Ordinateur (12 h)']);
  });

  it('ne remplace pas une ligne modifiée localement pendant l’échange', async () => {
    await pc.tanks.put(tank('a', 'Serveur'));
    await engine(pc).run('u1');
    await phone.tanks.put(tank('a', 'Local récent'));
    // Le téléphone n'a pas encore envoyé : sa version reste jusqu'au tour suivant.
    server.failWith = null;
    const e = engine(phone);
    await phone.syncMeta.put({ id: 'sync', userId: 'u1', cursor: 0 });
    await (e as unknown as { pullAll: () => Promise<void> }).pullAll();
    expect(await names(phone)).toEqual(['Local récent']);
  });

  it('renvoie une ligne modifiée pendant l’envoi, dans le même passage', async () => {
    await phone.tanks.put(tank('a', 'Avant'));
    const normal = server.request;
    let first = true;
    server.request = async (path, init) => {
      if (path === '/sync/push' && first) {
        first = false;
        await phone.tanks.update('a', { name: 'Pendant' });
      }
      return normal(path, init);
    };
    await engine(phone).run('u1');
    expect(server.pushes).toBe(2);
    expect(await phone.outbox.count()).toBe(0);
    await engine(pc).run('u1');
    expect(await names(pc)).toEqual(['Pendant']);
  });

  it('au premier passage, envoie tout ce que l’appareil contenait déjà', async () => {
    await phone.transaction('rw', phone.tanks, async (tx) => {
      // Données d'avant la synchronisation : jamais passées par la file.
      (tx.idbtrans as unknown as Record<string, boolean>)['aquariumRemote'] = true;
      await phone.tanks.bulkPut([tank('a', 'Ancien 1'), tank('b', 'Ancien 2')]);
    });
    expect(await phone.outbox.count()).toBe(0);
    await engine(phone).run('u1');
    await engine(pc).run('u1');
    expect(await names(pc)).toEqual(['Ancien 1', 'Ancien 2']);
  });

  it('un autre compte sur le même appareil repart d’un envoi complet', async () => {
    await phone.tanks.put(tank('a', 'Salon'));
    await engine(phone).run('u1');
    server.rows.clear();
    await engine(phone).run('u2');
    expect([...server.rows.keys()]).toEqual(['tanks|a']);
    expect((await phone.syncMeta.get('sync'))?.userId).toBe('u2');
  });

  it('ne fait voyager que les espèces créées par l’utilisateur', async () => {
    await phone.species.bulkPut([species('perso', 'custom'), species('integre', 'builtin')]);
    await engine(phone).run('u1');
    expect([...server.rows.keys()]).toEqual(['species|perso']);

    // Une fiche intégrée reçue par erreur est ignorée, et ne supprime pas la fiche locale.
    server.rows.set('species|integre', {
      table: 'species',
      id: 'integre',
      updatedAt: '2030-01-01T00:00:00.000Z',
      deleted: true,
      data: null,
      seq: ++server.seq,
    });
    server.rows.set('species|autre', {
      table: 'species',
      id: 'autre',
      updatedAt: '2030-01-01T00:00:00.000Z',
      deleted: false,
      data: { ...species('autre', 'builtin') },
      seq: ++server.seq,
    });
    await engine(phone).run('u1');
    expect(await phone.species.get('integre')).toBeDefined();
    expect(await phone.species.get('autre')).toBeUndefined();
  });

  it('écarte une ligne reçue dont l’identifiant ne correspond pas', async () => {
    server.rows.set('tanks|a', {
      table: 'tanks',
      id: 'a',
      updatedAt: U,
      deleted: false,
      data: { ...tank('b', 'Intrus') },
      seq: ++server.seq,
    });
    await engine(phone).run('u1');
    expect(await phone.tanks.count()).toBe(0);
  });

  it('n’envoie pas une ligne trop lourde, sans bloquer les autres', async () => {
    await phone.tanks.bulkPut([
      { ...tank('a', 'Lourd'), notes: 'x'.repeat(70 * 1024) },
      tank('b', 'Léger'),
    ]);
    await engine(phone).run('u1');
    expect([...server.rows.keys()]).toEqual(['tanks|b']);
    expect(await phone.outbox.count()).toBe(0);
  });

  it('n’appelle pas le serveur quand rien n’est à envoyer', async () => {
    await engine(phone).run('u1');
    expect(server.pushes).toBe(0);
  });

  it('au premier passage, n’ajoute pas les fiches du catalogue à la file', async () => {
    await phone.transaction('rw', phone.species, async (tx) => {
      (tx.idbtrans as unknown as Record<string, boolean>)['aquariumRemote'] = true;
      await phone.species.bulkPut([species('perso', 'custom'), species('integre', 'builtin')]);
    });
    server.failWith = 500;
    await expect(engine(phone).run('u1')).rejects.toMatchObject({ reason: 'server' });
    expect((await phone.outbox.toArray()).map((e) => e.key)).toEqual(['species|perso']);
  });

  it('n’appelle pas l’envoi quand la file ne contient que des lignes qui ne partent pas', async () => {
    await phone.species.put(species('perso', 'custom'));
    await phone.transaction('rw', phone.species, async (tx) => {
      (tx.idbtrans as unknown as Record<string, boolean>)['aquariumRemote'] = true;
      await phone.species.update('perso', { source: 'builtin' });
    });
    await engine(phone).run('u1');
    expect(server.pushes).toBe(0);
    expect(await phone.outbox.count()).toBe(0);
  });

  it('envoie une ligne pile à la taille maximale', async () => {
    const base = JSON.stringify({ ...tank('a', 'Limite'), notes: '' }).length;
    await phone.tanks.put({ ...tank('a', 'Limite'), notes: 'x'.repeat(64 * 1024 - base) });
    await engine(phone).run('u1');
    expect([...server.rows.keys()]).toEqual(['tanks|a']);
  });

  it('ignore une table inconnue ou des données qui ne sont pas un objet', async () => {
    const remote = (row: Partial<SyncChange> & { table: string; id: string }) =>
      server.rows.set(`${row.table}|${row.id}`, {
        updatedAt: U,
        deleted: false,
        data: null,
        seq: ++server.seq,
        ...row,
      });
    remote({ table: 'photos', id: 'p', data: { id: 'p' } } as unknown as SyncChange);
    remote({ table: 'tanks', id: 'x', data: 'texte' as unknown as null });
    remote({ table: 'tanks', id: 'y', data: null });
    await engine(phone).run('u1');
    expect(await phone.photos.count()).toBe(0);
    expect(await phone.tanks.count()).toBe(0);
  });

  it('applique une suppression reçue pour une ligne absente ou synchronisée, pas pour le catalogue', async () => {
    await phone.transaction('rw', phone.tanks, phone.species, async (tx) => {
      (tx.idbtrans as unknown as Record<string, boolean>)['aquariumRemote'] = true;
      await phone.tanks.put(tank('a', 'Salon'));
      await phone.species.put(species('integre', 'builtin'));
    });
    // Appareil déjà synchronisé : pas de premier envoi complet.
    await phone.syncMeta.put({ id: 'sync', userId: 'u1', cursor: 0 });
    for (const [table, id] of [
      ['tanks', 'a'],
      ['tanks', 'absent'],
      ['species', 'integre'],
    ] as const) {
      server.rows.set(`${table}|${id}`, {
        table,
        id,
        updatedAt: U,
        deleted: true,
        data: null,
        seq: ++server.seq,
      });
    }
    await engine(phone).run('u1');
    expect(await phone.tanks.count()).toBe(0);
    expect(await phone.species.get('integre')).toBeDefined();
  });

  it.each([
    [413, 'quota'],
    [500, 'server'],
  ])('signale une réponse %i et garde la file', async (status, reason) => {
    await phone.tanks.put(tank('a', 'Salon'));
    server.failWith = status;
    await expect(engine(phone).run('u1')).rejects.toMatchObject({ reason });
    expect(await phone.outbox.count()).toBe(1);
  });

  it('signale un échec de réception', async () => {
    await engine(phone).run('u1');
    server.failWith = 500;
    await expect(engine(phone).run('u1')).rejects.toMatchObject({ reason: 'server' });
    server.failWith = null;
    server.offline = true;
    await expect(engine(phone).run('u1')).rejects.toMatchObject({ reason: 'offline' });
  });
});

describe('SyncService', () => {
  const user = signal<{ id: string } | null>(null);

  function service() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AQUARIUM_DB, useValue: phone },
        { provide: AuthService, useValue: { user, authed: server.request } },
      ],
    });
    return TestBed.inject(SyncService);
  }

  afterEach(() => {
    user.set(null);
    TestBed.resetTestingModule();
  });

  it('reste à l’arrêt sans compte', async () => {
    const sync = service();
    await phone.tanks.put(tank('a', 'Salon'));
    await sync.sync();
    expect(sync.status()).toBe('off');
    expect(server.pushes).toBe(0);
  });

  it('synchronise et indique l’heure et la file', async () => {
    const sync = service();
    user.set({ id: 'u1' });
    await phone.tanks.put(tank('a', 'Salon'));
    await sync.sync();
    expect(sync.status()).toBe('ok');
    expect(sync.lastSync()).not.toBeNull();
    expect(sync.pending()).toBe(0);
    expect(server.rows.has('tanks|a')).toBe(true);
  });

  it('indique hors ligne, quota ou erreur', async () => {
    const sync = service();
    user.set({ id: 'u1' });
    await phone.tanks.put(tank('a', 'Salon'));
    server.offline = true;
    await sync.sync();
    expect(sync.status()).toBe('offline');
    expect(sync.pending()).toBe(1);
    server.offline = false;
    server.failWith = 413;
    await sync.sync();
    expect(sync.status()).toBe('quota');
    server.failWith = 500;
    await sync.sync();
    expect(sync.status()).toBe('error');
  });

  it('envoie quelques secondes après une modification locale', async () => {
    // Seulement les minuteries de l'appli : la base simulée garde les siennes.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = service();
    user.set({ id: 'u1' });
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10);
    const before = server.pushes;
    await phone.tanks.put(tank('a', 'Salon'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.pushes).toBe(before);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => {
      expect(server.rows.has('tanks|a')).toBe(true);
    });
    expect(sync.pending()).toBe(0);
  });

  it('ne lance qu’un échange à la fois et rejoue une demande reçue pendant', async () => {
    const sync = service();
    user.set({ id: 'u1' });
    await phone.tanks.put(tank('a', 'Salon'));
    const first = sync.sync();
    const second = sync.sync();
    expect(second).toBe(first);
    await first;
    expect(sync.status()).toBe('ok');
  });

  it('prend le verrou du navigateur quand il existe', async () => {
    const request = vi.fn((_n: string, cb: () => Promise<void>) => cb());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    try {
      const sync = service();
      user.set({ id: 'u1' });
      await sync.sync();
      expect(request).toHaveBeenCalledWith('aquarium-sync', expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('se synchronise au retour du réseau', async () => {
    const sync = service();
    user.set({ id: 'u1' });
    await phone.tanks.put(tank('a', 'Salon'));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => {
      expect(server.rows.has('tanks|a')).toBe(true);
    });
    expect(sync.status()).not.toBe('off');
  });

  describe('déclencheurs', () => {
    afterEach(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    async function ready() {
      const sync = service();
      user.set({ id: 'u1' });
      TestBed.tick();
      await sync.sync();
      return sync;
    }

    it('une modification locale part après le délai, pas avant', async () => {
      const sync = await ready();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const before = server.pushes;
      await phone.tanks.put(tank('a', 'Salon'));
      await vi.advanceTimersByTimeAsync(2900);
      expect(server.pushes).toBe(before);
      expect(sync.pending()).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      await vi.waitFor(() => {
        expect(server.pushes).toBe(before + 1);
      });
    });

    it('plusieurs modifications rapprochées partent ensemble', async () => {
      await ready();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const before = server.pushes;
      await phone.tanks.put(tank('a', 'Salon'));
      await vi.advanceTimersByTimeAsync(2000);
      await phone.tanks.put(tank('b', 'Nano'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(server.pushes).toBe(before);
      await vi.advanceTimersByTimeAsync(1100);
      await vi.waitFor(() => {
        expect(server.pushes).toBe(before + 1);
      });
    });

    it('rien ne part sans compte, même après une modification', async () => {
      service();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await phone.tanks.put(tank('a', 'Salon'));
      await vi.advanceTimersByTimeAsync(5000);
      expect(server.pushes + server.pulls).toBe(0);
    });

    it('repasse à l’arrêt à la déconnexion', async () => {
      const sync = await ready();
      expect(sync.status()).toBe('ok');
      user.set(null);
      TestBed.tick();
      expect(sync.status()).toBe('off');
    });

    it('se synchronise au retour du réseau', async () => {
      await ready();
      const before = server.pulls;
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => {
        expect(server.pulls).toBe(before + 1);
      });
    });

    it('se synchronise au retour au premier plan, pas quand l’appli passe en arrière-plan', async () => {
      await ready();
      const before = server.pulls;
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 50));
      expect(server.pulls).toBe(before);
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => {
        expect(server.pulls).toBe(before + 1);
      });
    });

    it('se synchronise toutes les 5 minutes', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      await ready();
      const before = server.pulls;
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await vi.waitFor(() => {
        expect(server.pulls).toBe(before + 1);
      });
    });

    it('cesse d’écouter quand le service est détruit', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      await ready();
      await phone.tanks.put(tank('a', 'Salon'));
      TestBed.resetTestingModule();
      const before = server.pulls + server.pushes;
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(server.pulls + server.pushes).toBe(before);
    });

    it('indique « en cours » pendant l’échange et rejoue une demande reçue pendant', async () => {
      const sync = await ready();
      const seen: string[] = [];
      server.onRequest = () => seen.push(sync.status());
      const before = server.pulls;
      const first = sync.sync();
      void sync.sync();
      await first;
      expect(seen.every((s) => s === 'syncing')).toBe(true);
      expect(server.pulls).toBe(before + 2);
    });
  });
});
