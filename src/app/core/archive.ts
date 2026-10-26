// Lecture et écriture des sauvegardes ZIP avec fflate, en flux :
// une seule photo est en mémoire à la fois pendant l'écriture comme pendant la lecture.

import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from 'fflate';

export interface ArchiveEntry {
  name: string;
  data: Blob;
}

/** Assemble un ZIP sans compression (les JPEG ne se compressent pas). */
export async function writeZip(entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>): Promise<Blob> {
  const parts: BlobPart[] = [];
  let failure: Error | null = null;
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else parts.push(chunk as Uint8Array<ArrayBuffer>);
    if (err || final) done();
  });
  for await (const e of entries) {
    const file = new ZipPassThrough(e.name);
    zip.add(file);
    file.push(new Uint8Array(await e.data.arrayBuffer()), true);
    if (failure) throw failure;
  }
  zip.end();
  await finished;
  if (failure) throw failure;
  return new Blob(parts, { type: 'application/zip' });
}

/** Liste les fichiers d'un ZIP (stockés ou compressés). */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  let failure: Error | null = null;
  const unzip = new Unzip((entry) => {
    const chunks: BlobPart[] = [];
    entry.ondata = (err, data, final) => {
      if (err) failure = err;
      else chunks.push(data as Uint8Array<ArrayBuffer>);
      if (final && !entry.name.endsWith('/')) out.set(entry.name, new Blob(chunks));
    };
    entry.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    unzip.push(value);
    if (failure) throw failure;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  return out;
}

/** Les quatre premiers octets d'un ZIP. */
export async function isZip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}
