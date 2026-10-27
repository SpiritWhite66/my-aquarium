import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataUrlToBlob, processPhoto } from './photos';

afterEach(() => vi.unstubAllGlobals());

function stubImaging(opts: { width?: number; height?: number; context?: boolean } = {}) {
  const bitmap = { width: opts.width ?? 3200, height: opts.height ?? 1600, close: vi.fn() };
  const createImageBitmap = vi.fn(async () => bitmap);
  const draws: unknown[][] = [];
  const converts: { size: [number, number]; options: unknown }[] = [];
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public w: number, public h: number) {}
    getContext() {
      return opts.context === false ? null : { drawImage: (...a: unknown[]) => void draws.push(a) };
    }
    async convertToBlob(options: unknown) {
      converts.push({ size: [this.w, this.h], options });
      return { size: [this.w, this.h] } as unknown as Blob;
    }
  });
  return { bitmap, createImageBitmap, draws, converts };
}
const file = (type = 'image/jpeg') => new File(['x'], 'a.jpg', { type });

describe('processPhoto', () => {
  it('réduit au plus grand côté de 1600 px (qualité 0,82) et 400 px pour la vignette (0,75)', async () => {
    const s = stubImaging({ width: 3200, height: 1600 });
    const p = await processPhoto(file());
    expect(p.width).toBe(3200);
    expect(p.height).toBe(1600);
    expect(s.converts).toEqual([
      { size: [1600, 800], options: { type: 'image/jpeg', quality: 0.82 } },
      { size: [400, 200], options: { type: 'image/jpeg', quality: 0.75 } },
    ]);
    expect(s.draws).toEqual([[s.bitmap, 0, 0, 1600, 800], [s.bitmap, 0, 0, 400, 200]]);
  });

  it('demande au navigateur d’appliquer l’orientation de la photo', async () => {
    const s = stubImaging();
    const f = file();
    await processPhoto(f);
    expect(s.createImageBitmap).toHaveBeenCalledWith(f, { imageOrientation: 'from-image' });
  });

  it('n’agrandit jamais une petite image et garde au moins un pixel', async () => {
    const s = stubImaging({ width: 300, height: 200 });
    await processPhoto(file());
    expect(s.converts.map((c) => c.size)).toEqual([[300, 200], [300, 200]]);
    const t = stubImaging({ width: 10000, height: 1 });
    await processPhoto(file());
    expect(t.converts.map((c) => c.size)).toEqual([[1600, 1], [400, 1]]);
  });

  it('arrondit les dimensions réduites', async () => {
    const s = stubImaging({ width: 2000, height: 1501 });
    await processPhoto(file());
    expect(s.converts[0].size).toEqual([1600, 1201]);
    expect(s.converts[1].size).toEqual([400, 300]);
  });

  it('libère l’image après usage, même si le traitement échoue', async () => {
    const ok = stubImaging();
    await processPhoto(file());
    expect(ok.bitmap.close).toHaveBeenCalledTimes(1);
    const bad = stubImaging({ context: false });
    await expect(processPhoto(file())).rejects.toThrow('Traitement d’image indisponible sur cet appareil.');
    expect(bad.bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('refuse un fichier qui n’est pas une image sans l’ouvrir', async () => {
    const s = stubImaging();
    await expect(processPhoto(file('application/pdf'))).rejects.toThrow('Ce fichier n’est pas une image.');
    expect(s.createImageBitmap).not.toHaveBeenCalled();
  });

  it('explique un format que le navigateur ne sait pas lire', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('décodage');
    });
    await expect(processPhoto(file('image/heic'))).rejects.toThrow('Format d’image non pris en charge (essaie JPEG ou PNG).');
  });
});

describe('dataUrlToBlob', () => {
  const text = (b: Blob) => b.text();

  it.each([
    ['data:image/png;base64,QUJD', 'image/png', 'ABC'],
    ['data:;base64,QUJD', 'application/octet-stream', 'ABC'],
    ['data:text/plain,hello%20world', 'text/plain', 'hello world'],
    ['data:text/plain,a%0Ab', 'text/plain', 'a\nb'],
    ['data:,rien', 'application/octet-stream', 'rien'],
  ])('%s', async (url, type, content) => {
    const blob = dataUrlToBlob(url);
    expect(blob.type).toBe(type);
    expect(await text(blob)).toBe(content);
  });

  it.each(['pas une url', 'xdata:text/plain,a', 'data:text/plain', '', 'image/png;base64,QUJD'])('refuse « %s »', (url) => {
    expect(() => dataUrlToBlob(url)).toThrow('Photo illisible dans la sauvegarde.');
  });
});
