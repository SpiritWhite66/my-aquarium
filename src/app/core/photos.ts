// Traitement des photos : réduction avant stockage (une photo de téléphone fait 3 à 8 Mo,
// on la ramène à ~200 Ko) et conversion pour l'export JSON.

const FULL_MAX = 1600; // plus grand côté, en pixels
const THUMB_MAX = 400;

export interface Processed {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

async function resize(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Traitement d’image indisponible sur cet appareil.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

/** Réduit une photo choisie par l'utilisateur. L'orientation EXIF est appliquée par le navigateur. */
export async function processPhoto(file: File): Promise<Processed> {
  if (!file.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Format d’image non pris en charge (essaie JPEG ou PNG).');
  }
  try {
    const [full, thumb] = await Promise.all([resize(bitmap, FULL_MAX, 0.82), resize(bitmap, THUMB_MAX, 0.75)]);
    return { full, thumb, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

// ---------- Export / import ----------

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Photo illisible dans la sauvegarde.');
  const type = m[1] || 'application/octet-stream';
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type });
}
