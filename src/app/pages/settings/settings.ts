import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { ThemeService, type ThemeChoice } from '../../core/theme';
import { TANK_TYPES, fmtShortDate } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { BackupService, fmtBytes } from '../../core/backup';
import { tasksToIcs } from '../../core/insights';

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
    .date { height: 40px; border: 1px solid var(--ln); border-radius: 12px; background: var(--sf); padding: 0 8px; font: 600 14px var(--font); }
    .linkbtn { border: 0; background: none; padding: 0; color: var(--pl); font: 600 13px var(--font); text-decoration: underline; cursor: pointer; }
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
        <h2 class="h2">Rappels</h2>
        <div class="card">
          <button class="it" type="button" style="width: 100%; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer" (click)="exportIcs()">
            <span class="ic w"><app-icon name="bell" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Ajouter à mon agenda</p><p class="sub">Fichier .ics avec les tâches répétées et une alerte à 9 h (Google Agenda, Outlook…)</p></div>
          </button>
          <div class="it" style="flex-wrap: wrap">
            <span class="ic"><app-icon name="moon" [size]="20" /></span>
            <div class="grow" style="min-width: 160px"><p style="font-weight: 600">Mode vacances</p><p class="sub">Décale au jour du retour les tâches qui tombent pendant l’absence</p></div>
            <div class="row" style="gap: 8px">
              <input type="date" class="date" aria-label="Date de retour" [min]="store.today()" [value]="returnDate()" (input)="returnDate.set($any($event.target).value)" />
              <button class="btn ton" type="button" [disabled]="!returnDate()" (click)="vacation()">Décaler</button>
            </div>
          </div>
        </div>
        <p class="sub" style="margin: 0">L’agenda n’est pas mis à jour automatiquement : réimporte le fichier si tu changes les tâches.</p>
      </section>

      <section>
        <h2 class="h2">Assistant IA</h2>
        <div class="card">
          <a class="it" routerLink="/import-ia">
            <span class="ic w"><app-icon name="upload" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Importer depuis l’IA</p><p class="sub">Inventaire, tests en gouttes ou bilan visuel à partir d’une photo</p></div>
            <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
          </a>
          <a class="it" routerLink="/diagnostic">
            <span class="ic w"><app-icon name="search" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Diagnostic IA</p><p class="sub">Envoie le dossier complet d’un bac (données, matériel, photos) à une IA</p></div>
            <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
          </a>
          <a class="it" href="ai/my-aquarium-diagnostic.zip" download>
            <span class="ic"><app-icon name="download" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Skill diagnostic pour Claude</p><p class="sub">my-aquarium-diagnostic</p></div>
          </a>
          <a class="it" href="ai/my-aquarium-json.zip" download>
            <span class="ic"><app-icon name="download" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Skill pour Claude</p><p class="sub">À ajouter dans Claude › Paramètres › Capacités</p></div>
          </a>
        </div>
      </section>

      <section>
        <h2 class="h2">Données</h2>
        <div class="card" style="padding: 14px; display: flex; flex-direction: column; gap: 12px">
          <p class="sub" style="margin: 0">
            Tout est stocké sur cet appareil{{ store.photos().length ? ', photos comprises (' + store.photos().length + ')' : '' }}. Pense à exporter régulièrement : la sauvegarde contient aussi les photos.
            Dernière sauvegarde : <b style="color: var(--ink)">{{ backup.lastBackup() ? date(backup.lastBackup()!) : 'jamais' }}</b>
          </p>
          <p class="sub" style="margin: 0">
            @if (backup.persisted() === true) {
              <span style="color: var(--ok); font-weight: 600">Stockage protégé</span> : le navigateur ne l’effacera pas pour libérer de la place.
            } @else if (backup.persisted() === false) {
              <span style="color: var(--wn); font-weight: 600">Stockage non protégé</span> : le navigateur peut l’effacer s’il manque de place.
              Installe l’app sur l’écran d’accueil puis
              <button type="button" class="linkbtn" (click)="backup.requestPersist()">réessaie</button>.
            }
            @if (backup.usage(); as u) { Espace utilisé : {{ bytes(u.used) }}. }
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

  protected readonly backup = inject(BackupService);
  protected readonly bytes = fmtBytes;
  protected readonly date = fmtShortDate;
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);

  protected readonly returnDate = signal('');

  protected async vacation(): Promise<void> {
    const until = this.returnDate();
    if (!until) return;
    const n = await this.store.postponeTasks(until);
    this.message.set({ text: n ? `${n} tâche${n > 1 ? 's' : ''} décalée${n > 1 ? 's' : ''} au ${fmtShortDate(until)} — bonnes vacances !` : 'Aucune tâche à décaler.', error: false });
  }

  protected exportIcs(): void {
    const ics = tasksToIcs(this.store.tasks(), this.store.activeTanks());
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aquariums-rappels.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected async exportFile(): Promise<void> {
    await this.backup.exportNow();
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
