// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKUP_TABLES, BACKUP_VERSION, checkBackup } from './backup-format';

const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

const tank = (id = 't', o = {}) => ({ id, name: `Bac ${id}`, type: 'planted', volumeGross: 60, archived: false, ...o });
const file = (data: Record<string, unknown>, version: number | string = 2) => ({ format: 'my-aquarium', version, exportedAt: '', data });
const wt = (id: string, tankId = 't') => ({ id, tankId, date: '2026-10-01', values: { ph: 7 } });
const photo = (id: string, o = {}) => ({ id, tankId: 't', date: '2026-10-01T10:00:00Z', ...o });
const jpg = (s: string) => new Blob([s], { type: 'image/jpeg' });

describe('en-tête', () => {
  it('connaît la version courante et ses 14 tables', () => {
    expect(BACKUP_VERSION).toBe(2);
    expect(BACKUP_TABLES).toEqual(['tanks', 'species', 'inhabitants', 'inhabitantEvents', 'waterTests', 'tasks', 'logs', 'observations', 'photos', 'equipment', 'consumables', 'co2Readings', 'settingChanges', 'diagnoses']);
  });

  it.each([null, undefined, 3, 'texte', [], {}, { format: 'autre', version: 2, data: {} }, { format: 'my-aquarium', version: 2 }, { format: 'my-aquarium', version: 2, data: 'x' }])('refuse %j', (raw) => {
    expect(() => checkBackup(raw)).toThrow('Ce fichier n’est pas une sauvegarde Mes aquariums.');
  });

  it.each([3, 0, '2', undefined])('refuse la version %j', (v) => {
    expect(() => checkBackup({ ...file({}), version: v })).toThrow(`Sauvegarde en version ${String(v)} : mets l’appli à jour avant de la restaurer.`);
  });

  it.each([1, 2])('accepte la version %i, même vide', (v) => {
    const r = checkBackup(file({}, v));
    expect(r.warnings).toEqual([]);
    expect(r.files.size).toBe(0);
    for (const t of BACKUP_TABLES) expect(r.data[t]).toEqual([]);
  });
});

describe('vérification des lignes', () => {
  const fails = (data: Record<string, unknown>) => {
    try {
      checkBackup(file(data));
    } catch (e) {
      return (e as Error).message;
    }
    return '';
  };

  it('garde les lignes valides telles quelles', () => {
    const r = checkBackup(file({ tanks: [tank('a'), tank('b')], waterTests: [wt('w', 'a')] }));
    expect(r.data.tanks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(r.data.waterTests).toHaveLength(1);
  });

  it('refuse une liste qui n’en est pas une', () => {
    expect(fails({ tanks: 'x' })).toBe('Sauvegarde abîmée, rien n’a été modifié : bacs : liste attendue.');
    expect(fails({ waterTests: {} })).toContain('relevés : liste attendue');
  });

  it('refuse une ligne sans identifiant, avec son numéro', () => {
    expect(fails({ tanks: [tank('a'), { name: 'x' }] })).toContain('bacs n°2 : identifiant manquant');
    expect(fails({ tanks: [null] })).toContain('bacs n°1 : identifiant manquant');
    expect(fails({ tanks: ['a'] })).toContain('bacs n°1 : identifiant manquant');
    expect(fails({ tanks: [{ id: 3, name: 'x' }] })).toContain('identifiant manquant');
  });

  it.each([
    ['name', 3],
    ['type', undefined],
    ['volumeGross', '60'],
    ['archived', 'non'],
    ['name', null],
  ])('refuse un bac dont « %s » vaut %j', (key, value) => {
    expect(fails({ tanks: [{ ...tank(), [key]: value }] })).toContain(`bacs n°1 : « ${key} » invalide`);
  });

  it('distingue liste et objet', () => {
    expect(fails({ observations: [{ id: 'o', tankId: 't', date: 'd', findings: {} }] })).toContain('« findings » invalide');
    expect(fails({ waterTests: [{ id: 'w', tankId: 't', date: 'd', values: [] }] })).toContain('« values » invalide');
    expect(fails({ waterTests: [{ id: 'w', tankId: 't', date: 'd', values: null }] })).toContain('« values » invalide');
    expect(fails({ observations: [{ id: 'o', tankId: 't', date: 'd', findings: [] }] })).toBe('');
  });

  it.each([0, 1.5, -1, '7', null, NaN])('refuse une tâche de fréquence %j', (everyDays) => {
    const task = { id: 'k', tankId: 't', type: 'custom', label: 'x', everyDays, nextDue: '2026-10-01', active: true };
    expect(fails({ tasks: [task] })).toContain('tâches n°1 : « everyDays » doit être un entier ≥ 1');
  });

  it('accepte une tâche de fréquence 1 ou plus', () => {
    const task = (everyDays: number) => ({ id: 'k' + everyDays, tankId: 't', type: 'custom', label: 'x', everyDays, nextDue: '2026-10-01', active: true });
    expect(fails({ tanks: [tank()], tasks: [task(1), task(30)] })).toBe('');
  });

  it('résume les erreurs : cinq au plus, puis le nombre des autres', () => {
    const rows = Array.from({ length: 8 }, (_, n) => ({ id: `t${n}`, name: 1, type: 'planted', volumeGross: 1, archived: false }));
    const m = fails({ tanks: rows });
    expect(m.startsWith('Sauvegarde abîmée, rien n’a été modifié : bacs n°1 : « name » invalide ; bacs n°2')).toBe(true);
    expect(m.endsWith(' (et 3 autre(s)).')).toBe(true);
    expect(m.split(' ; ')).toHaveLength(5);
    const exactly5 = fails({ tanks: rows.slice(0, 5) });
    expect(exactly5.endsWith('invalide.')).toBe(true);
    expect(exactly5).not.toContain('autre(s)');
  });

  it('signale les doublons sans les retirer', () => {
    const r = checkBackup(file({ tanks: [tank('a'), tank('a')] }));
    expect(r.warnings).toEqual(['bacs : doublon a ignoré']);
    expect(r.data.tanks).toHaveLength(2);
  });

  it('écarte les lignes dont le bac n’existe pas, avec le compte par table', () => {
    const r = checkBackup(file({
      tanks: [tank('a')],
      waterTests: [wt('w1', 'a'), wt('w2', 'x'), wt('w3', 'y')],
      logs: [{ id: 'l', tankId: 'zzz', type: 'custom', label: 'x', date: 'd' }],
      species: [{ id: 's', scientificName: 'x', kind: 'fish' }],
      equipment: [{ id: 'e', name: 'x', type: 'filter', tankId: 'x' }],
    }));
    expect(r.data.waterTests.map((w) => w.id)).toEqual(['w1']);
    expect(r.data.logs).toEqual([]);
    expect(r.data.species).toHaveLength(1);
    expect(r.data.equipment).toHaveLength(1);
    expect(r.warnings).toEqual(['2 relevés sans bac écarté(s)', '1 journal sans bac écarté(s)']);
  });
});

describe('photos', () => {
  it('reprend les images d’une ancienne sauvegarde (data URL) et les retire des métadonnées', async () => {
    const r = checkBackup(file({ tanks: [tank()], photos: [photo('p', { full: 'data:image/jpeg;base64,QUJD', thumb: 'data:image/jpeg;base64,QUI=' })] }, 1));
    expect(r.warnings).toEqual([]);
    expect(await r.files.get('p')!.full.text()).toBe('ABC');
    expect(await r.files.get('p')!.thumb.text()).toBe('AB');
    expect(Object.keys(r.data.photos[0])).not.toContain('full');
    expect(Object.keys(r.data.photos[0])).not.toContain('thumb');
  });

  it('écarte une photo dont l’image est illisible ou absente', () => {
    const r = checkBackup(file({ tanks: [tank()], photos: [photo('bad', { full: 'pas une url', thumb: 'data:image/jpeg;base64,QUI=' }), photo('none')] }, 1));
    expect(r.data.photos).toEqual([]);
    expect(r.files.size).toBe(0);
    expect(r.warnings).toEqual(['2 photo(s) sans image écartée(s)']);
  });

  it('lit les images d’un ZIP et les marque en JPEG', async () => {
    const images = new Map([['photos/p-full.jpg', new Blob(['F'])], ['photos/p-thumb.jpg', jpg('T')]]);
    const r = checkBackup(file({ tanks: [tank()], photos: [photo('p')] }), images);
    expect(r.files.get('p')!.full.type).toBe('image/jpeg');
    expect(r.files.get('p')!.thumb.type).toBe('image/jpeg');
    expect(await r.files.get('p')!.full.text()).toBe('F');
    expect(r.warnings).toEqual([]);
  });

  it('écarte la photo si une des deux images manque dans le ZIP', () => {
    const images = new Map([['photos/p-full.jpg', jpg('F')]]);
    const r = checkBackup(file({ tanks: [tank()], photos: [photo('p')] }), images);
    expect(r.data.photos).toEqual([]);
    expect(r.warnings).toEqual(['1 photo(s) sans image écartée(s)']);
    const onlyThumb = checkBackup(file({ tanks: [tank()], photos: [photo('p')] }), new Map([['photos/p-thumb.jpg', jpg('T')]]));
    expect(onlyThumb.data.photos).toEqual([]);
  });

  it('retire la couverture d’un bac quand sa photo n’existe plus, sinon la garde', () => {
    const images = new Map([['photos/ok-full.jpg', jpg('F')], ['photos/ok-thumb.jpg', jpg('T')]]);
    const r = checkBackup(file({ tanks: [tank('a', { coverPhotoId: 'ok' }), tank('b', { coverPhotoId: 'perdue' }), tank('c')], photos: [photo('ok', { tankId: 'a' })] }), images);
    const cover = (id: string) => (r.data.tanks.find((t) => t.id === id) as { coverPhotoId?: string }).coverPhotoId;
    expect(cover('a')).toBe('ok');
    expect(cover('b')).toBeUndefined();
    expect(cover('c')).toBeUndefined();
  });

  it('écarte les photos d’un bac absent avant de chercher leurs images', () => {
    const images = new Map([['photos/p-full.jpg', jpg('F')], ['photos/p-thumb.jpg', jpg('T')]]);
    const r = checkBackup(file({ tanks: [tank('a')], photos: [photo('p', { tankId: 'x' })] }), images);
    expect(r.warnings).toEqual(['1 photos sans bac écarté(s)']);
    expect(r.files.size).toBe(0);
  });
});
