// Format des sauvegardes et vérification avant restauration.
//  - v1 : un fichier JSON, photos en data URL (anciennes sauvegardes, toujours acceptées) ;
//  - v2 : un ZIP avec data.json et les images dans photos/.
// La restauration efface tout : on refuse un fichier abîmé au lieu de l'importer à moitié.

import type { ExportFile, ExportedPhoto, Photo, PhotoFile } from './models';
import { dataUrlToBlob } from './photos';

export const BACKUP_VERSION = 2;

type Kind = 'string' | 'number' | 'boolean' | 'array' | 'object';
type Shape = Record<string, Kind>;

/** Champs obligatoires de chaque table (les autres sont facultatifs). */
const SHAPES = {
  tanks: { name: 'string', type: 'string', volumeGross: 'number', archived: 'boolean' },
  species: { scientificName: 'string', kind: 'string' },
  inhabitants: {
    tankId: 'string',
    speciesId: 'string',
    quantity: 'number',
    unit: 'string',
    status: 'string',
  },
  inhabitantEvents: { inhabitantId: 'string', tankId: 'string', date: 'string', type: 'string' },
  waterTests: { tankId: 'string', date: 'string', values: 'object' },
  tasks: {
    tankId: 'string',
    type: 'string',
    label: 'string',
    everyDays: 'number',
    nextDue: 'string',
    active: 'boolean',
  },
  logs: { tankId: 'string', type: 'string', label: 'string', date: 'string' },
  observations: { tankId: 'string', date: 'string', findings: 'array' },
  photos: { tankId: 'string', date: 'string' },
  equipment: { name: 'string', type: 'string' },
  consumables: { name: 'string', category: 'string' },
  co2Readings: { tankId: 'string', date: 'string' },
  settingChanges: { equipmentId: 'string', date: 'string', field: 'string' },
  diagnoses: { tankId: 'string', date: 'string', actions: 'array' },
} satisfies Record<string, Shape>;

export type BackupTable = keyof typeof SHAPES;
export const BACKUP_TABLES = Object.keys(SHAPES) as BackupTable[];

/** Tables rattachées à un bac : une ligne dont le bac n'existe pas est écartée. */
const BY_TANK: BackupTable[] = [
  'inhabitants',
  'inhabitantEvents',
  'waterTests',
  'tasks',
  'logs',
  'observations',
  'photos',
  'co2Readings',
  'diagnoses',
];

export interface CheckedBackup {
  data: ExportFile['data'];
  files: Map<string, Omit<PhotoFile, 'id'>>;
  /** Remarques sans gravité (lignes orphelines écartées, photos sans image…). */
  warnings: string[];
}

const LABELS: Record<BackupTable, string> = {
  tanks: 'bacs',
  species: 'fiches',
  inhabitants: 'habitants',
  inhabitantEvents: 'événements',
  waterTests: 'relevés',
  tasks: 'tâches',
  logs: 'journal',
  observations: 'bilans',
  photos: 'photos',
  equipment: 'matériel',
  consumables: 'consommables',
  co2Readings: 'mesures CO2',
  settingChanges: 'réglages',
  diagnoses: 'diagnostics',
};

const kindOf = (v: unknown): Kind | 'other' =>
  Array.isArray(v) ? 'array' : v === null ? 'other' : (typeof v as Kind);

/**
 * Vérifie une sauvegarde déjà lue (data.json ou ancien JSON).
 * `images` : images trouvées dans le ZIP (photos/<id>-full.jpg…), absentes pour une v1.
 */
export function checkBackup(raw: unknown, images?: Map<string, Blob>): CheckedBackup {
  const f = raw as Partial<ExportFile> | null;
  if (
    !f ||
    typeof f !== 'object' ||
    f.format !== 'my-aquarium' ||
    !f.data ||
    typeof f.data !== 'object'
  ) {
    throw new Error('Ce fichier n’est pas une sauvegarde Mes aquariums.');
  }
  if (f.version !== 1 && f.version !== 2) {
    throw new Error(
      `Sauvegarde en version ${String(f.version)} : mets l’appli à jour avant de la restaurer.`,
    );
  }
  const src = f.data as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const data = {} as Record<BackupTable, { id: string }[]>;

  for (const table of BACKUP_TABLES) {
    const list = src[table] ?? [];
    if (!Array.isArray(list)) {
      errors.push(`${LABELS[table]} : liste attendue`);
      continue;
    }
    const shape: Shape = SHAPES[table];
    const ids = new Set<string>();
    list.forEach((row, i) => {
      if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') {
        errors.push(`${LABELS[table]} n°${i + 1} : identifiant manquant`);
        return;
      }
      const r = row as Record<string, unknown>;
      for (const [k, kind] of Object.entries(shape)) {
        if (kindOf(r[k]) !== kind) errors.push(`${LABELS[table]} n°${i + 1} : « ${k} » invalide`);
      }
      if (
        table === 'tasks' &&
        !(Number.isInteger(r['everyDays']) && (r['everyDays'] as number) >= 1)
      )
        errors.push(`${LABELS[table]} n°${i + 1} : « everyDays » doit être un entier ≥ 1`);
      if (ids.has(r['id'] as string))
        warnings.push(`${LABELS[table]} : doublon ${r['id'] as string} ignoré`);
      ids.add(r['id'] as string);
    });
    data[table] = list as { id: string }[];
  }
  if (errors.length) {
    const more = errors.length > 5 ? ` (et ${errors.length - 5} autre(s))` : '';
    throw new Error(
      `Sauvegarde abîmée, rien n’a été modifié : ${errors.slice(0, 5).join(' ; ')}${more}.`,
    );
  }

  // Lignes rattachées à un bac absent : écartées.
  const tanks = new Set(data.tanks.map((t) => t.id));
  for (const table of BY_TANK) {
    const before = data[table].length;
    data[table] = data[table].filter((r) => tanks.has((r as unknown as { tankId: string }).tankId));
    const dropped = before - data[table].length;
    if (dropped) warnings.push(`${dropped} ${LABELS[table]} sans bac écarté(s)`);
  }

  // Images : dans le ZIP (v2) ou en data URL dans le JSON (v1).
  const files = new Map<string, Omit<PhotoFile, 'id'>>();
  const photos: Photo[] = [];
  for (const p of data.photos as unknown as (Photo &
    Partial<Pick<ExportedPhoto, 'full' | 'thumb'>>)[]) {
    const { full, thumb, ...meta } = p;
    let img: Omit<PhotoFile, 'id'> | undefined;
    if (typeof full === 'string' && typeof thumb === 'string') {
      try {
        img = { full: dataUrlToBlob(full), thumb: dataUrlToBlob(thumb) };
      } catch {
        img = undefined;
      }
    } else if (images) {
      const fb = images.get(`photos/${p.id}-full.jpg`);
      const tb = images.get(`photos/${p.id}-thumb.jpg`);
      if (fb && tb) img = { full: jpeg(fb), thumb: jpeg(tb) };
    }
    if (!img) continue;
    files.set(p.id, img);
    photos.push(meta);
  }
  const lost = data.photos.length - photos.length;
  if (lost) warnings.push(`${lost} photo(s) sans image écartée(s)`);
  data.photos = photos;

  // Une couverture de bac qui pointe vers une photo absente est retirée.
  const photoIds = new Set(photos.map((p) => p.id));
  data.tanks = data.tanks.map((t) => {
    const c = (t as { coverPhotoId?: string }).coverPhotoId;
    return c && !photoIds.has(c) ? { ...t, coverPhotoId: undefined } : t;
  });

  return { data: data as unknown as ExportFile['data'], files, warnings };
}

const jpeg = (b: Blob) => (b.type === 'image/jpeg' ? b : new Blob([b], { type: 'image/jpeg' }));
