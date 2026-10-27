// Chronologie de l'onglet Entretien : opérations d'entretien et événements des habitants dans une seule liste.

import type { Inhabitant, InhabitantEvent, MaintenanceLog, Species } from './models';
import { isPlantTask, speciesName } from './labels';

export const TIMELINE_EVENT_LABELS: Record<InhabitantEvent['type'], string> = {
  added: 'Ajout',
  birth: 'Naissance',
  death: 'Décès',
  disease: 'Maladie',
  treatment: 'Traitement',
  trim: 'Taille',
  propagated: 'Bouturage',
  moved: 'Déplacement',
  note: 'Note',
};

export interface TimelineItem {
  id: string;
  date: string;
  title: string;
  note?: string;
  plant: boolean;
}

/** Les 30 derniers éléments du bac, du plus récent au plus ancien. */
export function maintenanceTimeline(
  tankId: string,
  logs: MaintenanceLog[],
  events: InhabitantEvent[],
  inhabitants: Inhabitant[],
  speciesById: Map<string, Species>,
): TimelineItem[] {
  const byInhabitant = new Map(inhabitants.map((i) => [i.id, i]));
  const fromLogs = logs
    .filter((l) => l.tankId === tankId)
    .map((l) => ({ id: l.id, date: l.date, title: l.label, note: l.note, plant: isPlantTask(l.type) }));
  const fromEvents = events
    .filter((e) => e.tankId === tankId)
    .map((e) => {
      const sp = speciesById.get(byInhabitant.get(e.inhabitantId)?.speciesId ?? '');
      const delta = e.quantityDelta ? ` (${e.quantityDelta > 0 ? '+' : ''}${e.quantityDelta})` : '';
      return { id: e.id, date: e.date, title: `${TIMELINE_EVENT_LABELS[e.type]} — ${speciesName(sp)}${delta}`, note: e.note, plant: sp?.kind === 'plant' };
    });
  return [...fromLogs, ...fromEvents].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}
