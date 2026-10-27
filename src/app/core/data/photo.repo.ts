import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { newId, now } from './util';
import { processPhoto } from '../photos';
import type { Photo, PhotoFile } from '../models';

/** Photos : informations dans `photos`, images dans `photoFiles`. */
@Injectable({ providedIn: 'root' })
export class PhotoRepo {
  private readonly db = inject(AQUARIUM_DB);

  /** Réduit puis enregistre une ou plusieurs photos. Renvoie les identifiants créés. */
  async addPhotos(
    files: File[],
    target: { tankId: string; inhabitantId?: string },
    caption?: string,
  ): Promise<string[]> {
    // Réduction des images d'abord : une transaction IndexedDB ne survit pas à un traitement asynchrone externe.
    const processed: Photo[] = [];
    const images: PhotoFile[] = [];
    for (const file of files) {
      const p = await processPhoto(file);
      // La date de la photo est celle du fichier quand elle est fiable, sinon maintenant.
      const taken =
        file.lastModified && file.lastModified < Date.now()
          ? new Date(file.lastModified)
          : new Date();
      const id = newId();
      processed.push({
        id,
        updatedAt: now(),
        ...target,
        date: taken.toISOString(),
        caption: caption || undefined,
        width: p.width,
        height: p.height,
      });
      images.push({ id, full: p.full, thumb: p.thumb });
    }
    await this.db.transaction(
      'rw',
      [this.db.photos, this.db.photoFiles, this.db.tanks],
      async () => {
        await this.db.photoFiles.bulkPut(images);
        await this.db.photos.bulkPut(processed);
        // Première photo d'un bac : elle devient sa photo de couverture.
        const tank = await this.db.tanks.get(target.tankId);
        if (tank && !tank.coverPhotoId && !target.inhabitantId && processed.length) {
          await this.db.tanks.update(tank.id, { coverPhotoId: processed[0].id, updatedAt: now() });
        }
      },
    );
    return processed.map((p) => p.id);
  }

  /** Images d'une photo, lues à la demande. */
  photoFile(id: string): Promise<PhotoFile | undefined> {
    return this.db.photoFiles.get(id);
  }

  async setCaption(id: string, caption: string): Promise<void> {
    await this.db.photos.update(id, { caption: caption.trim() || undefined, updatedAt: now() });
  }

  async setCover(tankId: string, photoId: string | undefined): Promise<void> {
    await this.db.tanks.update(tankId, { coverPhotoId: photoId, updatedAt: now() });
  }

  async deletePhoto(photo: Photo): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.photos, this.db.photoFiles, this.db.tanks],
      async () => {
        await this.db.photos.delete(photo.id);
        await this.db.photoFiles.delete(photo.id);
        const tank = await this.db.tanks.get(photo.tankId);
        if (tank?.coverPhotoId !== photo.id) return;
        // La couverture passe à la photo de bac la plus récente restante.
        const rest = await this.db.photos
          .where('tankId')
          .equals(tank.id)
          .filter((p) => !p.inhabitantId)
          .sortBy('date');
        await this.db.tanks.update(tank.id, { coverPhotoId: rest.at(-1)?.id, updatedAt: now() });
      },
    );
  }
}
