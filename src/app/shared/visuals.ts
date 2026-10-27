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

export { isPlantTask } from '../core/labels';
