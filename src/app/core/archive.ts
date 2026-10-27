// Lecture et écriture des sauvegardes ZIP avec fflate, en flux :
// une seule photo est en mémoire à la fois pendant l'écriture comme pendant la lecture.

import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from 'fflate';

export interface ArchiveEntry {
  name: string;
  data: Blob;
}

type Chunk = Uint8Array<ArrayBuffer>;

/** Destination d'un ZIP écrit en flux (par exemple un fichier choisi par l'utilisateur). */
export interface ZipSink {
  write(chunk: Chunk): void | Promise<void>;
}

/**
 * Écrit un ZIP sans compression (les JPEG ne se compressent pas), morceau par morceau :
 * `onChunk` reçoit chaque morceau dans l'ordre, et la lecture de l'entrée suivante attend qu'il soit traité.
 */
export async function streamZip(
  entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>,
  onChunk: (chunk: Chunk) => void | Promise<void>,
): Promise<void> {
  let failure = null as Error | null;
  let chain: Promise<void> = Promise.resolve();
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else chain = chain.then(() => onChunk(chunk));
    if (err || final) done();
  });
  for await (const e of entries) {
    const file = new ZipPassThrough(e.name);
    zip.add(file);
    file.push(new Uint8Array(await e.data.arrayBuffer()), true);
    if (failure) throw failure;
    await chain;
  }
  zip.end();
  await finished;
  if (failure) throw failure;
  await chain;
}

/** Assemble un ZIP en mémoire (petites sauvegardes, navigateurs sans écriture directe sur le disque). */
export async function writeZip(entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>): Promise<Blob> {
  const parts: BlobPart[] = [];
  await streamZip(entries, (chunk) => void parts.push(chunk));
  return new Blob(parts, { type: 'application/zip' });
}

/** Liste les fichiers d'un ZIP (stockés ou compressés). */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  let failure = null as Error | null;
  const unzip = new Unzip((entry) => {
    const chunks: BlobPart[] = [];
    entry.ondata = (err, data, final) => {
      if (err) failure = err;
      else chunks.push(data);
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
