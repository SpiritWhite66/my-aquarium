import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Icon } from './icon';
import { PhotoRepo } from '../core/data/photo.repo';

/** Bouton d'ajout de photos : ouvre l'appareil photo ou la galerie, réduit les images puis les enregistre. */
@Component({
  selector: 'app-photo-add',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <label [class]="cls()" [class.disabled]="busy()">
      <app-icon name="camera" [size]="20" />{{ busy() ? 'Enregistrement…' : label() }}
      <input type="file" accept="image/*" multiple class="sr-only" [disabled]="busy()" (change)="pick($event)" />
    </label>
    @if (error(); as e) {
      <p class="err" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    label { cursor: pointer; }
    label.disabled { opacity: .6; cursor: progress; }
    .err { color: var(--dg); font-size: 13px; flex-basis: 100%; }
  `,
})
export class PhotoAdd {
  protected readonly photoRepo = inject(PhotoRepo);

  readonly tankId = input.required<string>();
  readonly inhabitantId = input<string>();
  readonly label = input('Ajouter des photos');
  /** Classes du bouton, ex. « btn fill » ou « fab ». */
  readonly cls = input('btn ton');
  readonly added = output<string[]>();

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async pick(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ids = await this.photoRepo.addPhotos(files, { tankId: this.tankId(), inhabitantId: this.inhabitantId() });
      this.added.emit(ids);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Impossible d’enregistrer la photo.');
    } finally {
      this.busy.set(false);
    }
  }
}
