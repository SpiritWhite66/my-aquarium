import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Icônes au trait, reprises de la maquette. Décoratives : le texte ou l'aria-label du parent porte le sens.
const PATHS: Record<string, string[]> = {
  home: ['M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z'],
  tank: ['M3 6h18v13H3z', 'M3 10c3 1.5 6-1.5 9 0s6 1.5 9 0'],
  book: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
  settings: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  plus: ['M12 5v14M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  back: ['M15 5l-7 7 7 7'],
  close: ['M6 6l12 12M18 6L6 18'],
  chevron: ['M9 5l7 7-7 7'],
  edit: ['M4 20h4L19 9l-4-4L4 16z'],
  trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M16 16l4.5 4.5'],
  sprout: ['M12 21V9', 'M12 13c-4 0-6-3-6-7 4 0 6 3 6 7z', 'M12 11c0-4 2-7 6-7 0 4-2 7-6 7z'],
  landscape: ['M3 19c3-1 4-5 9-5s6 4 9 5', 'M8 15c0-4 1-8 4-11M12 14c1-3 3-5 6-6M9 14c-2-2-4-3-6-3'],
  fish: ['M3 12c3-4 8-5 12-3l4-3v12l-4-3c-4 2-9 1-12-3z'],
  shrimp: ['M4 14c2-5 9-7 15-4', 'M6 14c4 3 9 3 13-1', 'M19 10l2-4M8 15l-1 3M12 16v3M16 15l1 3'],
  snail: ['M4 18h14a3 3 0 0 0 3-3', 'M13 18a5 5 0 1 0-5-5c0 2 1.5 3 3 3s2-1 2-2-1-1.5-1.5-1.5', 'M18 15l1-6M20.5 15l1.5-5'],
  stem: ['M12 21V4', 'M12 8l-4-2M12 11l4-2M12 14l-4-2M12 17l4-2'],
  leaves: ['M5 19c0-6 3-10 7-12-1 5-3 9-7 12z', 'M19 19c0-6-3-10-7-12 1 5 3 9 7 12z'],
  floating: ['M4 10a4 4 0 1 0 8 0a4 4 0 1 0-8 0z', 'M13 9a3 3 0 1 0 6 0a3 3 0 1 0-6 0z', 'M8 14v5M16 12v6'],
  grass: ['M4 18c2-3 4-3 5 0M9 18c2-4 4-4 6 0M14 18c2-3 4-3 6 0'],
  drop: ['M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z'],
  bucket: ['M4 8h16M6 8l1 12h10l1-12M9 4h6'],
  scissors: ['M6 15.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M6 3.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M8 7.5L20 17M8 16.5L20 7'],
  glass: ['M4 4h16v16H4z', 'M8 15l7-7'],
  filter: ['M7 3h10v18H7z', 'M10 8h4M10 12h4M10 16h4'],
  vacuum: ['M8 3v10a4 4 0 0 0 8 0V3', 'M5 21h14'],
  bubble: ['M8 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M15 9a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M10 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'],
  tube: ['M9 3h6M10 3v13a2 2 0 0 0 4 0V3', 'M10 10h4'],
  task: ['M5 4h14v16H5z', 'M9 9l2 2 4-4M9 15h6'],
  warn: ['M12 4l9 16H3z', 'M12 10v4M12 17.5v.5'],
  download: ['M12 4v11M7 10l5 5 5-5M5 20h14'],
  upload: ['M12 20V9M7 14l5-5 5 5M5 4h14'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z'],
  star: ['M12 4l2.5 5.2 5.7.8-4.1 4 1 5.7L12 17l-5.1 2.7 1-5.7-4.1-4 5.7-.8z'],
  eye: ['M2 12c3-5 6.5-7 10-7s7 2 10 7c-3 5-6.5 7-10 7s-7-2-10-7z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  tool: ['M14.5 4a4.5 4.5 0 0 0-4.3 5.8L4 16l4 4 6.2-6.2A4.5 4.5 0 0 0 20 9.5l-2.7 2.7-3-3L17 6.5A4.5 4.5 0 0 0 14.5 4z'],
  box: ['M4 8l8-4 8 4v9l-8 4-8-4z', 'M4 8l8 4 8-4M12 12v9'],
  heater: ['M9 3h6v18H9z', 'M12 7v6M11 16h2'],
  bulb: ['M9 18h6M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z'],
  thermo: ['M12 3a2 2 0 0 0-2 2v9.5a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z', 'M12 9v7'],
  timer: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z', 'M12 8v4l3 2M10 2h4'],
  moon: ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'],
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:inline-grid;place-items:center;flex:none' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      [attr.stroke-width]="stroke()" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(22);
  readonly stroke = input(1.8);
  protected readonly paths = computed(() => PATHS[this.name()] ?? []);
}
