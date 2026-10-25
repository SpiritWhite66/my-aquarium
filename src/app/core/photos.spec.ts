import { describe, expect, it } from 'vitest';
import { blobToDataUrl, dataUrlToBlob } from './photos';

describe('photos : conversion pour la sauvegarde', () => {
  it('conserve les octets et le type après un aller-retour', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 250, 251]);
    const url = await blobToDataUrl(new Blob([bytes], { type: 'image/jpeg' }));
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const back = dataUrlToBlob(url);
    expect(back.type).toBe('image/jpeg');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
  });

  it('refuse une donnée qui n’est pas une data URL', () => {
    expect(() => dataUrlToBlob('pas une image')).toThrow();
  });
});
