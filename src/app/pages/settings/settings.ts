import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { ThemeService, type ThemeChoice } from '../../core/theme';
import { TANK_TYPES, fmtShortDate } from '../../core/labels';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-settings',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section { display: flex; flex-direction: column; gap: 10px; }
    .it { display: flex; align-items: center; gap: 12px; padding: 12px 14px; min-height: 60px; color: inherit; text-decoration: none; }
    .it + .it { border-top: 1px solid var(--ln); }
    a.it:hover { background: var(--sf2); color: inherit; }
    .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--sf2); color: var(--mu); }
    .ic.p { background: var(--plb); color: var(--pl); }
    .ic.w { background: var(--wab); color: var(--wa); }
    .newtank { color: var(--pl); font-weight: 600; }
    .seg { padding: 3px; gap: 3px; }
    .seg button { height: 34px; }
    .msg { font-size: 13px; }
  `,
  template: `
    <div class="page" style="max-width: 720px">
      <header class="top"><h1 class="h1">Réglages</h1></header>

      <section>
        <h2 class="h2">Mes bacs</h2>
        <div class="card">
          @for (t of store.tanks(); track t.id) {
            <a class="it" [routerLink]="['/bacs', t.id, 'modifier']">
              <span class="ic" [class.p]="t.type === 'planted'" [class.w]="t.type !== 'planted'"><app-icon [name]="t.type === 'planted' ? 'sprout' : 'fish'" [size]="20" /></span>
              <div class="grow">
                <p style="font-weight: 600">{{ t.name }}</p>
                <p class="sub"><span class="num">{{ t.volumeGross }}</span> L · {{ types[t.type] }}{{ t.archived ? ' · archivé' : '' }}</p>
              </div>
              <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
            </a>
          }
          <a class="it newtank" routerLink="/bacs/nouveau"><span class="ic p"><app-icon name="plus" [size]="20" /></span>Nouveau bac</a>
        </div>
      </section>

      <section>
        <h2 class="h2">Affichage</h2>
        <div class="card">
          <div class="it">
            <p class="grow" style="font-weight: 600">Thème</p>
            <div class="seg" role="group" aria-label="Thème">
              @for (c of themes; track c[0]) {
                <button type="button" [class.on]="theme.choice() === c[0]" [attr.aria-pressed]="theme.choice() === c[0]" (click)="theme.choice.set(c[0])">{{ c[1] }}</button>
              }
            </div>
          </div>
          <div class="it">
            <div class="grow"><p style="font-weight: 600">Unités</p><p class="sub">°C · mg/L · °d</p></div>
          </div>
        </div>
      </section>

      <section>
        <h2 class="h2">Données</h2>
        <div class="card" style="padding: 14px; display: flex; flex-direction: column; gap: 12px">
          <p class="sub" style="margin: 0">
            Tout est stocké sur cet appareil. Pense à exporter régulièrement.
            Dernière sauvegarde : <b style="color: var(--ink)">{{ lastBackup() ?? 'jamais' }}</b>
          </p>
          <div class="row" style="flex-wrap: wrap; gap: 8px">
            <button class="btn fill" type="button" (click)="exportFile()"><app-icon name="download" [size]="20" />Exporter</button>
            <label class="btn ton" style="cursor: pointer">
              <app-icon name="upload" [size]="20" />Importer
              <input type="file" accept="application/json,.json" class="sr-only" (change)="importFile($event)" />
            </label>
          </div>
          @if (message(); as m) {
            <p class="msg" [style.color]="m.error ? 'var(--dg)' : 'var(--ok)'" role="status">{{ m.text }}</p>
          }
        </div>
      </section>
    </div>
  `,
})
export class SettingsPage {
  protected readonly store = inject(AquariumStore);
  protected readonly theme = inject(ThemeService);
  protected readonly types = TANK_TYPES;
  protected readonly themes: [ThemeChoice, string][] = [['light', 'Clair'], ['dark', 'Sombre'], ['auto', 'Auto']];

  protected readonly lastBackup = signal(readBackup());
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);

  protected async exportFile(): Promise<void> {
    const data = await this.store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-aquarium-${this.store.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    try {
      localStorage.setItem('lastBackup', data.exportedAt);
    } catch {
      /* stockage indisponible */
    }
    this.lastBackup.set(fmtShortDate(data.exportedAt));
    this.message.set({ text: 'Sauvegarde téléchargée.', error: false });
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm('L’import remplace toutes les données de cet appareil. Continuer ?')) return;
    try {
      await this.store.importData(JSON.parse(await file.text()));
      this.message.set({ text: 'Données importées.', error: false });
    } catch (err) {
      this.message.set({ text: err instanceof Error ? err.message : 'Import impossible.', error: true });
    }
  }
}

function readBackup(): string | null {
  try {
    const v = localStorage.getItem('lastBackup');
    return v ? fmtShortDate(v) : null;
  } catch {
    return null;
  }
}
