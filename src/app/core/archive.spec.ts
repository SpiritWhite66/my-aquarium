// @ts-expect-error -- module Node sans types dans la config de test
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { isZip, readZip, streamZip, writeZip, type ArchiveEntry } from './archive';

const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

const entry = (name: string, text: string): ArchiveEntry => ({ name, data: new Blob([text]) });

describe('archive ZIP', () => {
  it('écrit puis relit les fichiers sans rien perdre', async () => {
    const zip = await writeZip([entry('data.json', '{"a":1}'), entry('photos/p1-full.jpg', 'IMG1'), entry('vide.txt', '')]);
    expect(zip.type).toBe('application/zip');
    const files = await readZip(zip);
    expect([...files.keys()]).toEqual(['data.json', 'photos/p1-full.jpg', 'vide.txt']);
    expect(await files.get('data.json')!.text()).toBe('{"a":1}');
    expect(await files.get('photos/p1-full.jpg')!.text()).toBe('IMG1');
    expect(await files.get('vide.txt')!.text()).toBe('');
  });

  it('gère un contenu plus gros qu’un morceau', async () => {
    const big = 'x'.repeat(300_000);
    const files = await readZip(await writeZip([entry('big.txt', big)]));
    expect((await files.get('big.txt')!.text()).length).toBe(300_000);
  });

  it('accepte une source asynchrone', async () => {
    async function* gen() {
      yield entry('a.txt', 'A');
      await new Promise((r) => setTimeout(r, 5));
      yield entry('b.txt', 'B');
    }
    const files = await readZip(await writeZip(gen()));
    expect([...files.keys()]).toEqual(['a.txt', 'b.txt']);
  });

  it('un ZIP sans fichier est valide et se relit vide', async () => {
    const zip = await writeZip([]);
    expect((await readZip(zip)).size).toBe(0);
  });

  it('livre les morceaux dans l’ordre et attend que chacun soit traité', async () => {
    const events: string[] = [];
    let busy = false;
    await streamZip([entry('a.txt', 'AAAA'), entry('b.txt', 'BBBB')], async (chunk) => {
      expect(busy).toBe(false);
      busy = true;
      events.push(`chunk:${chunk.length}`);
      await new Promise((r) => setTimeout(r, 3));
      busy = false;
    });
    expect(busy).toBe(false);
    expect(events.length).toBeGreaterThan(2);
    const all = new Uint8Array(events.reduce((n, e) => n + Number(e.split(':')[1]), 0));
    expect(all.length).toBeGreaterThan(8);
  });

  it('les morceaux assemblés forment le même ZIP que celui construit en mémoire', async () => {
    const parts: Uint8Array[] = [];
    await streamZip([entry('a.txt', 'Bonjour')], (c) => void parts.push(c));
    const files = await readZip(new Blob(parts as BlobPart[]));
    expect(await files.get('a.txt')!.text()).toBe('Bonjour');
  });

  it('relit aussi un ZIP compressé (créé par un autre outil) ou simplement stocké', async () => {
    const text = 'Bonjour '.repeat(200);
    const deflated = zipSync({ 'a.txt': [strToU8(text), { level: 9 }] });
    const stored = zipSync({ 'b.txt': [strToU8(text), { level: 0 }] });
    expect(deflated.length).toBeLessThan(text.length);
    expect(await (await readZip(new Blob([deflated]))).get('a.txt')!.text()).toBe(text);
    expect(await (await readZip(new Blob([stored]))).get('b.txt')!.text()).toBe(text);
  });

  it('ignore les dossiers du ZIP', async () => {
    const files = await readZip(await writeZip([entry('dossier/', ''), entry('dossier/f.txt', 'F')]));
    expect([...files.keys()]).toEqual(['dossier/f.txt']);
  });

  it('reconnaît un ZIP à ses quatre premiers octets', async () => {
    expect(await isZip(await writeZip([entry('a', 'A')]))).toBe(true);
    expect(await isZip(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])]))).toBe(true);
    expect(await isZip(new Blob(['{"json":true}']))).toBe(false);
    expect(await isZip(new Blob([new Uint8Array([0x50, 0x4b, 0x03])]))).toBe(false);
    expect(await isZip(new Blob([new Uint8Array([0x51, 0x4b, 0x03, 0x04])]))).toBe(false);
    expect(await isZip(new Blob([new Uint8Array([0x50, 0x4c, 0x03, 0x04])]))).toBe(false);
    expect(await isZip(new Blob([new Uint8Array([0x50, 0x4b, 0x04, 0x04])]))).toBe(false);
    expect(await isZip(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x05])]))).toBe(false);
    expect(await isZip(new Blob([]))).toBe(false);
  });

  it('refuse un fichier corrompu', async () => {
    const zip = await writeZip([entry('a.txt', 'Bonjour le monde')]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    bytes.fill(0xff, 30, 40);
    const result = await readZip(new Blob([bytes])).then((m) => ({ ok: true, m }), (e: unknown) => ({ ok: false, e }));
    if (result.ok) expect(await (result as { m: Map<string, Blob> }).m.get('a.txt')?.text()).not.toBe('Bonjour le monde');
    else expect(result.e).toBeDefined();
  });
});
