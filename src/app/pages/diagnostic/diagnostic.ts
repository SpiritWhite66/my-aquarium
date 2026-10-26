import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { buildDossier, diagnosticRequest, photoFileName } from '../../core/diagnostic';
import { fmtShortDate } from '../../core/labels';
import { measureStatus } from '../../core/follow-up';
import { addDays, daysBetween, localDay } from '../../core/dates';
import { Icon } from '../../shared/icon';
import { PhotoUrls } from '../../shared/photo-urls';

const MAX_PHOTOS = 6;

/**
 * Prépare le dossier de diagnostic d'un bac (JSON + photos) et l'envoie à une app d'IA
 * avec le skill my-aquarium-diagnostic. La réponse revient par l'écran d'import IA.
 */
@Component({
  selector: 'app-diagnostic',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .how { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .how ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.45; }
    .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
    .ph-pick { position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; border: 3px solid transparent; padding: 0; background: var(--sf2); cursor: pointer; }
    .ph-pick.on { border-color: var(--wa); }
    .ph-pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ph-pick .tick { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 12px; background: var(--sf); color: var(--wa); display: grid; place-items: center; border: 2px solid var(--wa); }
    .ph-pick.on .tick { background: var(--wa); color: var(--on-wa); }
    .summary { padding: 12px 14px; font-size: 14px; display: flex; flex-direction: column; gap: 4px; }
    .msg { font-size: 13px; }
    .fu { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; box-shadow: inset 3px 0 0 var(--wa); }
    .fu-h { font-weight: 600; font-size: 14px; }
    .fu-l { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .fu-l li { display: flex; gap: 6px; align-items: baseline; color: var(--wn); }
    .fu-l li.m-ok { color: var(--ok); }
    .fu-l li.m-unk { color: var(--mu); }
    .fu-l app-icon { flex: none; position: relative; top: 2px; }
  `,
  template: `
    <div class="page" style="max-width: 760px; gap: 16px">
      <header class="top">
        <div>
          <h1 class="h1">Diagnostic IA</h1>
          <p class="sub">L’IA croise tes relevés, ton matériel, ton entretien et tes photos pour trouver la cause d’un problème.</p>
        </div>
      </header>

      @if (store.tankViews().length) {
        <section class="card how">
          <ol>
            <li>Décris le problème et choisis les photos.</li>
            <li>Envoie le dossier à Claude avec le skill <b>my-aquarium-diagnostic</b> (ou colle le prompt dans une autre IA).</li>
            <li>Lis son analyse, puis colle sa réponse dans <a routerLink="/import-ia" [queryParams]="{ bac: tankId() }">Importer depuis l’IA</a> : le plan d’action devient des tâches.</li>
          </ol>
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <a class="btn ton" href="ai/my-aquarium-diagnostic.zip" download><app-icon name="download" [size]="20" />Skill diagnostic</a>
            <button class="btn out" type="button" (click)="copyPrompt()"><app-icon [name]="copied() ? 'check' : 'book'" [size]="20" />{{ copied() ? 'Prompt copié' : 'Copier le prompt' }}</button>
          </div>
        </section>

        <div class="field">
          <label for="tank">Bac</label>
          <select id="tank" (change)="tankId.set($any($event.target).value)">
            @for (v of store.tankViews(); track v.tank.id) { <option [value]="v.tank.id" [selected]="v.tank.id === tankId()">{{ v.tank.name }}</option> }
          </select>
        </div>
        @if (previous(); as prev) {
          <section class="card fu">
            <label class="check" style="min-height: 0">
              <input type="checkbox" [checked]="followUp()" (change)="followUp.set($any($event.target).checked)" />
              <span>Suivi du diagnostic du {{ date(prev.date) }}</span>
            </label>
            @if (followUp()) {
              <p class="sub" style="margin: 0">{{ prev.hypotheses[0]?.title }}{{ dueLabel() ? ' · ' + dueLabel() : '' }}</p>
              <p class="fu-h">Actions : {{ doneCount() }} sur {{ prev.actions.length }} faites</p>
              <ul class="fu-l">
                @for (a of prev.actions; track $index) {
                  <li [class.m-ok]="a.done"><app-icon [name]="a.done ? 'check' : 'close'" [size]="14" [stroke]="2.4" />{{ a.title }}</li>
                }
              </ul>
              @if (measures().length) {
                <p class="fu-h">Mesures demandées</p>
                <ul class="fu-l">
                  @for (m of measures(); track m.label) {
                    <li [class.m-ok]="m.done" [class.m-unk]="m.done === undefined">
                      <app-icon [name]="m.done ? 'check' : m.done === false ? 'close' : 'eye'" [size]="14" [stroke]="2.4" />{{ m.label }}{{ m.detail ? ' : ' + m.detail : '' }}
                    </li>
                  }
                </ul>
                @if (missingMeasures()) {
                  <a class="sub" style="margin: 0; font-weight: 600" routerLink="/releve" [queryParams]="{ bac: tankId() }">Faire un relevé avant d’envoyer</a>
                }
              }
              <p class="sub" style="margin: 0">L’IA recevra ce bilan et tout ce qui a changé depuis : relevés, entretien, engrais, réglages, notes d’algues.</p>
            }
          </section>
        }

        <div class="field">
          <label for="q">Quel est le problème ?</label>
          <textarea id="q" rows="3" [value]="question()" (input)="question.set($any($event.target).value)"
            placeholder="Algues filamenteuses sur les plantes à tiges depuis 2 semaines… (vide : bilan général)"></textarea>
        </div>

        <section class="stack">
          <h2 class="h2"><app-icon name="camera" [size]="18" />Photos jointes <span class="sub" style="margin: 0; font-weight: 500">{{ selected().size }} / {{ maxPhotos }}</span></h2>
          @if (photos().length) {
            <div class="photos">
              @for (p of photos(); track p.id) {
                <button type="button" class="ph-pick" [class.on]="selected().has(p.id)" [attr.aria-pressed]="selected().has(p.id)"
                  [attr.aria-label]="'Joindre la photo du ' + date(p.date)" (click)="togglePhoto(p.id)">
                  <img [src]="urls.url(p.id)" alt="" loading="lazy" />
                  <span class="tick">@if (selected().has(p.id)) { <app-icon name="check" [size]="14" [stroke]="2.4" /> }</span>
                </button>
              }
            </div>
            <p class="sub" style="margin: 0">Les photos récentes et nettes du problème (algues, plante, animal) aident beaucoup.</p>
          } @else {
            <p class="sub" style="margin: 0">Aucune photo pour ce bac. Ajoutes-en dans l’onglet Photos : l’IA pourra voir le problème.</p>
          }
        </section>

        @if (dossier(); as d) {
          <div class="card summary">
            <p><b>Contenu du dossier</b></p>
            <p class="sub" style="margin: 0">
              {{ d.population.length }} espèces · {{ d.water.tests.length }} relevés · {{ d.equipment.length }} équipements ·
              {{ d.maintenance.recent.length }} opérations d’entretien · {{ d.previousDiagnoses.length }} diagnostic(s) précédent(s) · {{ selected().size }} photo(s)
            </p>
            @if (missing().length) { <p class="sub" style="margin: 0; color: var(--wn)">Manque pour un meilleur diagnostic : {{ missing().join(', ') }}.</p> }
          </div>
        }

        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn fill" type="button" [disabled]="busy()" (click)="send()"><app-icon name="upload" [size]="20" />Envoyer à l’IA</button>
          <button class="btn out" type="button" [disabled]="busy()" (click)="download()"><app-icon name="download" [size]="20" />Télécharger</button>
        </div>
        @if (message(); as m) { <p class="msg" role="status">{{ m }}</p> }
      } @else if (store.ready()) {
        <p class="card empty">Crée d’abord un bac.</p>
      }
    </div>
  `,
})
export class DiagnosticPage {
  protected readonly store = inject(AquariumStore);
  protected readonly urls = inject(PhotoUrls);
  protected readonly date = fmtShortDate;
  protected readonly maxPhotos = MAX_PHOTOS;

  readonly bac = input<string>();

  protected readonly tankId = signal('');
  protected readonly question = signal('');
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  private readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.tankId()));
  protected readonly photos = computed(() => this.store.photos().filter((p) => p.tankId === this.tankId()));
  /** Dernier diagnostic du bac. */
  protected readonly previous = computed(() => this.store.diagnoses().filter((d) => d.tankId === this.tankId()).at(-1));
  /** Suivi coché par défaut si le dernier diagnostic date de moins de 90 jours. */
  protected readonly followUp = linkedSignal(() => {
    const p = this.previous();
    return !!p && daysBetween(localDay(p.date), this.store.today()) <= 90;
  });
  private readonly followUpData = computed(() => ({
    tests: this.store.waterTests(),
    co2Readings: this.store.co2Readings(),
    photos: this.store.photos(),
    logs: this.store.logs(),
    settingChanges: this.store.settingChanges(),
    observations: this.store.observations(),
  }));
  protected readonly measures = computed(() => {
    const p = this.previous();
    return p ? measureStatus(p, this.followUpData()) : [];
  });
  protected readonly missingMeasures = computed(() => this.measures().some((m) => m.done === false));
  protected readonly doneCount = computed(() => this.previous()?.actions.filter((a) => a.done).length ?? 0);
  protected readonly dueLabel = computed(() => {
    const p = this.previous();
    if (!p?.followUp) return '';
    const due = addDays(localDay(p.date), p.followUp.inDays);
    const days = daysBetween(this.store.today(), due);
    return days > 0 ? `suivi prévu dans ${days} j` : days === 0 ? 'suivi prévu aujourd’hui' : `suivi prévu le ${this.date(due)}`;
  });

  /**
   * Par défaut : les 3 photos les plus récentes. En suivi : celles prises depuis le diagnostic,
   * plus la dernière d'avant pour comparer.
   */
  protected readonly selected = linkedSignal(() => {
    const photos = this.photos();
    const prev = this.previous();
    if (!this.followUp() || !prev) return new Set(photos.slice(0, 3).map((p) => p.id));
    const after = photos.filter((p) => p.date > prev.date).slice(0, 3);
    const before = photos.find((p) => p.date <= prev.date);
    return new Set([...after, ...(before ? [before] : [])].map((p) => p.id));
  });

  private readonly chosenPhotos = computed(() => this.photos().filter((p) => this.selected().has(p.id)));

  protected readonly dossier = computed(() => {
    const v = this.view();
    if (!v) return undefined;
    return buildDossier({
      tank: v.tank,
      species: this.store.species(),
      inhabitants: this.store.inhabitants(),
      events: this.store.inhabitantEvents(),
      tests: this.store.waterTests(),
      tasks: this.store.tasks(),
      logs: this.store.logs(),
      equipment: this.store.equipment(),
      co2Readings: this.store.co2Readings(),
      observations: this.store.observations(),
      diagnoses: this.store.diagnoses(),
      settingChanges: this.store.settingChanges(),
      consumables: this.store.consumables(),
      photos: this.chosenPhotos(),
      question: this.question(),
      today: this.store.today(),
      followUpOf: this.followUp() ? this.previous() : undefined,
      allPhotos: this.photos(),
    });
  });

  /** Informations absentes qui limiteraient l'analyse. */
  protected readonly missing = computed(() => {
    const d = this.dossier();
    if (!d) return [];
    const out: string[] = [];
    const last = d.water.tests.at(-1)?.values ?? {};
    if (!d.water.tests.length) out.push('relevés d’eau');
    else {
      if (last.no3 == null) out.push('NO3');
      if (last.po4 == null) out.push('PO4');
      if (last.kh == null) out.push('KH');
    }
    if (!d.equipment.some((e) => e.light?.schedule)) out.push('horaires d’éclairage (Matériel)');
    if (!d.equipment.some((e) => e.filter?.flowLh)) out.push('débit du filtre');
    if (!this.selected().size) out.push('photos');
    return out;
  });

  constructor() {
    effect(() => {
      if (this.tankId()) return;
      const tanks = this.store.tankViews();
      const id = tanks.find((v) => v.tank.id === this.bac())?.tank.id ?? tanks[0]?.tank.id;
      if (id) this.tankId.set(id);
    });
  }

  protected togglePhoto(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PHOTOS) next.add(id);
      return next;
    });
  }

  private files(): File[] {
    const d = this.dossier()!;
    const slug = this.view()!.tank.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-');
    const json = new File([JSON.stringify(d, null, 2)], `dossier-${slug}-${this.store.today()}.json`, { type: 'application/json' });
    const photos = this.chosenPhotos().map((p, i) => new File([p.full], photoFileName(p, i), { type: 'image/jpeg' }));
    return [json, ...photos];
  }

  /** Partage vers l'app d'IA (mobile) ; sinon téléchargement + demande copiée. */
  protected async send(): Promise<void> {
    if (!this.dossier()) return;
    const files = this.files();
    const prev = this.followUp() ? this.previous() : undefined;
    const text = diagnosticRequest(this.view()!.tank.name, this.question(), prev ? this.date(prev.date) : undefined);
    this.busy.set(true);
    try {
      if (navigator.canShare?.({ files, text })) {
        await navigator.share({ files, text });
        this.message.set('Dossier envoyé. Quand l’IA a répondu, colle sa réponse dans « Importer depuis l’IA ».');
      } else {
        await this.downloadFiles(files);
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        this.message.set('Fichiers téléchargés et demande copiée : joins-les dans Claude et colle la demande.');
      }
    } catch {
      /* partage annulé */
    } finally {
      this.busy.set(false);
    }
  }

  protected async download(): Promise<void> {
    if (!this.dossier()) return;
    await this.downloadFiles(this.files());
    this.message.set('Dossier et photos téléchargés.');
  }

  private async downloadFiles(files: File[]): Promise<void> {
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      // Laisse le navigateur traiter chaque téléchargement.
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  protected async copyPrompt(): Promise<void> {
    const prompt = await fetch('ai/diagnostic-prompt.md').then((r) => r.text());
    await navigator.clipboard.writeText(prompt);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2500);
  }
}
