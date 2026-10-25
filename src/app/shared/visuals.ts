import type { Species, TaskType } from '../core/models';

/** Icône représentant une espèce (en attendant les photos). */
export function speciesIcon(s: Species): string {
  if (s.kind === 'fish') return 'fish';
  if (s.kind === 'shrimp') return 'shrimp';
  if (s.kind === 'snail') return 'snail';
  switch (s.flora?.placement) {
    case 'foreground':
      return 'grass';
    case 'epiphyte':
      return 'leaves';
    case 'floating':
      return 'floating';
    default:
      return s.flora?.form === 'tige' ? 'stem' : 'sprout';
  }
}

export function taskIcon(type: TaskType): string {
  return (
    {
      water_change: 'bucket',
      filter_clean: 'filter',
      glass_clean: 'glass',
      gravel_vacuum: 'vacuum',
      plant_trim: 'scissors',
      fertilize: 'drop',
      co2_refill: 'bubble',
      water_test: 'tube',
      custom: 'task',
    } as Record<TaskType, string>
  )[type];
}

/** Les tâches liées aux plantes sont en vert, les autres en bleu (comme la maquette). */
export function isPlantTask(type: TaskType): boolean {
  return type === 'plant_trim' || type === 'fertilize' || type === 'co2_refill';
}
