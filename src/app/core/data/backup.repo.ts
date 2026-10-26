import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { newId, now, type New } from './util';
import { isZip, readZip, writeZip, type ArchiveEntry } from '../archive';
import { BACKUP_TABLES, BACKUP_VERSION, checkBackup } from '../backup-format';
import type { Entity, ExportFile } from '../models';

/** Sauvegarde ZIP et restauration. */
@Injectable({ providedIn: 'root' })
export class BackupRepo {
  private readonly db = inject(AQUARIUM_DB);

  /**
   * Sauvegarde complète en ZIP : data.json (toutes les tables sauf les préférences de l'appareil)
   * et les images dans photos/. Les images sont lues une par une.
   */
  async exportArchive(): Promise<{ blob: Blob; exportedAt: string }> {
    const exportedAt = now();
    const data: Record<string, unknown> = {};
    for (const table of BACKUP_TABLES) {
      data[table] =
        table === 'species'
          ? await this.db.species.where('source').equals('custom').toArray()
          : await this.db.table(table).toArray();
    }
    const file: ExportFile = {
      format: 'my-aquarium',
      version: BACKUP_VERSION,
      exportedAt,
      data: data as ExportFile['data'],
    };
    const ids = (await this.db.photos.toCollection().primaryKeys()) as string[];
    const db = this.db;
    async function* entries(): AsyncGenerator<ArchiveEntry> {
      yield {
        name: 'data.json',
        data: new Blob([JSON.stringify(file)], { type: 'application/json' }),
      };
      for (const id of ids) {
        const img = await db.photoFiles.get(id);
        if (!img) continue;
        yield { name: `photos/${id}-full.jpg`, data: img.full };
        yield { name: `photos/${id}-thumb.jpg`, data: img.thumb };
      }
    }
    return { blob: await writeZip(entries()), exportedAt };
  }

  /**
   * Remplace toutes les données par celles d'une sauvegarde (ZIP, ou ancien JSON).
   * Le fichier est entièrement vérifié avant d'effacer quoi que ce soit.
   * Renvoie les remarques sans gravité (lignes écartées…).
   */
  async importBackup(file: Blob): Promise<string[]> {
    let raw: unknown;
    let images: Map<string, Blob> | undefined;
    try {
      if (await isZip(file)) {
        images = await readZip(file);
        const json = images.get('data.json');
        if (!json) throw new Error('data.json absent');
        raw = JSON.parse(await json.text());
      } else raw = JSON.parse(await file.text());
    } catch {
      throw new Error('Fichier illisible : ce n’est pas une sauvegarde Mes aquariums.');
    }
    const { data, files, warnings } = checkBackup(raw, images);
    const d = data as unknown as Record<string, Entity[]>;
    const tables = [...BACKUP_TABLES.map((t) => this.db.table(t)), this.db.photoFiles];
    await this.db.transaction('rw', tables, async () => {
      for (const table of BACKUP_TABLES) {
        if (table === 'species') await this.db.species.where('source').equals('custom').delete();
        else await this.db.table(table).clear();
      }
      await this.db.photoFiles.clear();
      for (const table of BACKUP_TABLES) {
        const rows =
          table === 'species' ? d[table].map((s) => ({ ...s, source: 'custom' })) : d[table];
        await this.db.table(table).bulkPut(rows);
      }
      await this.db.photoFiles.bulkPut([...files].map(([id, f]) => ({ id, ...f })));
    });
    return warnings;
  }
}
