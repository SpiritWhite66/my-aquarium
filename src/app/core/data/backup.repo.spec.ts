// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFakeIndexedDb } from '../fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from '../db';
import { readZip, writeZip } from '../archive';
import { BackupRepo } from './backup.repo';
import { TankRepo } from './tank.repo';
import { LivestockRepo } from './livestock.repo';
import { PrefsRepo } from './prefs.repo';

const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let db: AquariumDb;
let repo: BackupRepo;
let n = 0;
beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb(`backup-repo-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
  repo = TestBed.inject(BackupRepo);
});
afterEach(async () => {
  TestBed.resetTestingModule();
  await db.delete();
});

const tank = {
  name: 'Salon',
  type: 'planted',
  volumeGross: 60,
  startDate: '2026-01-01',
  co2: false,
  archived: false,
} as const;
const jpg = (s: string) => new Blob([s], { type: 'image/jpeg' });
async function seed() {
  const t = await TestBed.inject(TankRepo).saveTank(tank);
  await db.species.bulkPut([
    {
      id: 'builtin-1',
      source: 'builtin',
      scientificName: 'Intégrée',
      commonNames: ['Intégrée'],
      kind: 'fish',
      updatedAt: '',
    } as never,
    {
      id: 'custom-1',
      source: 'custom',
      scientificName: 'Perso',
      commonNames: ['Perso'],
      kind: 'fish',
      updatedAt: '',
    } as never,
  ]);
  await db.photos.bulkPut([
    { id: 'p1', updatedAt: '', tankId: t, date: '2026-10-01T10:00:00Z', width: 1, height: 1 },
    { id: 'p2', updatedAt: '', tankId: t, date: '2026-10-02T10:00:00Z', width: 1, height: 1 },
  ]);
  await db.photoFiles.put({ id: 'p1', full: jpg('FULL1'), thumb: jpg('THUMB1') }); // p2 sans image
  await TestBed.inject(PrefsRepo).saveNotificationPrefs({ enabled: true });
  return t;
}

describe('export', () => {
  it('écrit data.json et les images des photos, sans les préférences ni les fiches intégrées', async () => {
    const t = await seed();
    const { blob, exportedAt } = await repo.exportArchive();
    expect(blob.type).toBe('application/zip');
    const files = await readZip(blob);
    expect([...files.keys()].sort()).toEqual([
      'data.json',
      'photos/p1-full.jpg',
      'photos/p1-thumb.jpg',
    ]);
    const json = JSON.parse(await files.get('data.json')!.text());
    expect(json).toMatchObject({ format: 'my-aquarium', version: 2, exportedAt });
    expect(Object.keys(json.data)).toHaveLength(14);
    expect(json.data).not.toHaveProperty('prefs');
    expect(json.data.tanks.map((x: { id: string }) => x.id)).toEqual([t]);
    expect(json.data.species.map((s: { id: string }) => s.id)).toEqual(['custom-1']);
    expect(json.data.photos.map((p: { id: string }) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(await files.get('photos/p1-full.jpg')!.text()).toBe('FULL1');
    expect(await files.get('photos/p1-thumb.jpg')!.text()).toBe('THUMB1');
    expect(Math.abs(Date.now() - new Date(exportedAt).getTime())).toBeLessThan(10_000);
  });

  it('écrit le même contenu en flux vers un fichier', async () => {
    await seed();
    const chunks: Uint8Array[] = [];
    const { exportedAt } = await repo.exportArchiveTo({ write: (c) => void chunks.push(c) });
    expect(exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const files = await readZip(new Blob(chunks as BlobPart[]));
    expect([...files.keys()]).toContain('data.json');
    expect(JSON.parse(await files.get('data.json')!.text()).exportedAt).toBe(exportedAt);
  });

  it('attend que chaque morceau soit écrit', async () => {
    await seed();
    let open = 0;
    let maxOpen = 0;
    await repo.exportArchiveTo({
      write: async () => {
        open++;
        maxOpen = Math.max(maxOpen, open);
        await new Promise((r) => setTimeout(r, 1));
        open--;
      },
    });
    expect(maxOpen).toBe(1);
  });
});

describe('import', () => {
  const backup = (data: Record<string, unknown>) => ({
    format: 'my-aquarium',
    version: 2,
    exportedAt: '',
    data,
  });
  const zipOf = (json: unknown, extra: Record<string, string> = {}) =>
    writeZip([
      { name: 'data.json', data: new Blob([JSON.stringify(json)]) },
      ...Object.entries(extra).map(([name, text]) => ({ name, data: new Blob([text]) })),
    ]);

  it('remplace tout, garde les fiches intégrées et recrée les fiches personnelles', async () => {
    await seed();
    const t = {
      id: 'new',
      updatedAt: '',
      name: 'Importé',
      type: 'planted',
      volumeGross: 10,
      archived: false,
    };
    const file = backup({
      tanks: [t],
      species: [
        {
          id: 'custom-2',
          updatedAt: '',
          scientificName: 'Nouvelle',
          commonNames: ['N'],
          kind: 'fish',
          source: 'builtin',
        },
      ],
    });
    expect(await repo.importBackup(await zipOf(file))).toEqual([]);
    expect((await db.tanks.toArray()).map((x) => x.id)).toEqual(['new']);
    expect(await db.photos.count()).toBe(0);
    expect(await db.photoFiles.count()).toBe(0);
    expect((await db.species.toArray()).map((s) => s.id).sort()).toEqual(['builtin-1', 'custom-2']);
    expect((await db.species.get('custom-2'))?.source).toBe('custom');
    expect((await db.species.get('builtin-1'))?.source).toBe('builtin');
  });

  it('ne touche pas aux préférences de l’appareil', async () => {
    await seed();
    await repo.importBackup(await zipOf(backup({})));
    expect(await db.prefs.count()).toBe(1);
  });

  it('range les images du ZIP à côté de leur photo', async () => {
    const file = backup({
      tanks: [
        { id: 't', updatedAt: '', name: 'A', type: 'planted', volumeGross: 10, archived: false },
      ],
      photos: [{ id: 'p', updatedAt: '', tankId: 't', date: '2026-10-01', width: 1, height: 1 }],
    });
    await repo.importBackup(
      await zipOf(file, { 'photos/p-full.jpg': 'F', 'photos/p-thumb.jpg': 'T' }),
    );
    const img = (await db.photoFiles.get('p'))!;
    expect(await img.full.text()).toBe('F');
    expect(await img.thumb.text()).toBe('T');
  });

  it('lit une ancienne sauvegarde JSON', async () => {
    const file = {
      ...backup({
        tanks: [
          {
            id: 'old',
            updatedAt: '',
            name: 'Ancien',
            type: 'planted',
            volumeGross: 10,
            archived: false,
          },
        ],
      }),
      version: 1,
    };
    await repo.importBackup(new Blob([JSON.stringify(file)]));
    expect((await db.tanks.get('old'))?.name).toBe('Ancien');
  });

  it('renvoie les remarques sans gravité', async () => {
    const file = backup({
      tanks: [],
      waterTests: [{ id: 'w', tankId: 'x', date: 'd', values: {}, updatedAt: '' }],
    });
    expect(await repo.importBackup(await zipOf(file))).toEqual(['1 relevés sans bac écarté(s)']);
  });

  it.each([
    ['un ZIP sans data.json', () => writeZip([{ name: 'autre.txt', data: new Blob(['x']) }])],
    ['un texte quelconque', () => Promise.resolve(new Blob(['pas du json']))],
    [
      'un JSON cassé dans le ZIP',
      () => writeZip([{ name: 'data.json', data: new Blob(['{ cassé']) }]),
    ],
  ])('refuse %s sans rien effacer', async (_name, make) => {
    await seed();
    await expect(repo.importBackup(await make())).rejects.toThrow(
      'Fichier illisible : ce n’est pas une sauvegarde Mes aquariums.',
    );
    expect(await db.tanks.count()).toBe(1);
    expect(await db.photoFiles.count()).toBe(1);
  });

  it('refuse un contenu abîmé sans rien effacer', async () => {
    await seed();
    await expect(
      repo.importBackup(await zipOf(backup({ tanks: [{ id: 'x', name: 3 }] }))),
    ).rejects.toThrow('Sauvegarde abîmée');
    expect(await db.tanks.count()).toBe(1);
    expect(await db.species.count()).toBe(2);
  });

  it('un export puis un import redonnent les mêmes données', async () => {
    const t = await seed();
    await TestBed.inject(LivestockRepo).addInhabitant({
      tankId: t,
      speciesId: 'custom-1',
      quantity: 3,
      unit: 'individual',
      addedDate: '2026-10-01',
      status: 'healthy',
    });
    const { blob } = await repo.exportArchive();
    await repo.importBackup(blob);
    expect((await db.tanks.toArray()).map((x) => x.id)).toEqual([t]);
    expect(await db.inhabitants.count()).toBe(1);
    expect((await db.photoFiles.get('p1'))?.full).toBeDefined();
    expect(await db.photos.count()).toBe(1);
  });
});
