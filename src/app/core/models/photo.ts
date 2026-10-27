import type { Entity } from './entity';

export interface Photo extends Entity {
  tankId: string;
  inhabitantId?: string; // vide : photo du bac
  date: string; // ISO datetime de la prise (ou de l'ajout)
  caption?: string;
  width: number;
  height: number;
}

/**
 * Images d'une photo, rangées à part : les listes ne chargent que les informations
 * de `Photo`, les images sont lues à la demande.
 */
export interface PhotoFile {
  id: string; // même id que la photo
  full: Blob; // ~1600 px
  thumb: Blob; // ~400 px
}

/** Photo telle qu'écrite dans une ancienne sauvegarde JSON (images en data URL). */
export type ExportedPhoto = Photo & { full: string; thumb: string };
