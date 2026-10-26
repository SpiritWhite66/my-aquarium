import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { dueLabel, fmtShortDate, frequencyLabel, speciesName } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { isPlantTask, taskIcon } from '../../shared/visuals';
import { WaterChangeSheet } from '../../shared/water-change-sheet';
import type { MaintenanceTask, SettingChange } from '../../core/models';
import { changeEffect, describeChange, effectVerdict } from '../../core/settings-history';
import { PhotoCompare } from '../../shared/photo-compare';
import { equipmentIcon, equipmentSummary } from '../gear/gear';
import { EQUIPMENT_TYPES } from '../../core/labels';
import { gearChecks } from '../../core/insights';

const EVENT_LABELS: Record<string, string> = {
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

@Component({
  selector: 'app-maintenance',
  imports: [RouterLink, Icon, WaterChangeSheet, PhotoCompare],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .t { display: flex; align-items: center; gap: 12px; padding: 10px 8px 10px 14px; }
    .t + .t { border-top: 1px solid var(--ln); }
    .tic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--wab); color: var(--wa); text-decoration: none; }
    .tic.p { background: var(--plb); color: var(--pl); }
    .tn { font-weight: 600; font-size: 15px; color: inherit; text-decoration: none; }
    .today { color: var(--ink); font-weight: 700; }
    .late { color: var(--dg); font-weight: 700; }
    .tl { position: relative; padding-left: 22px; display: flex; flex-direction: column; gap: 14px; }
    .tl::before { content: ''; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 2px; background: var(--ln); }
    .ev { position: relative; }
    .ev::before { content: ''; position: absolute; left: -21px; top: 5px; width: 12px; height: 12px; border-radius: 6px; background: var(--sf); border: 2px solid var(--pl); }
    .ev.w::before { border-color: var(--wa); }
    .ev p:first-child { font-weight: 600; }
    .sc { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
    .sc + .sc { border-top: 1px solid var(--ln); }
    .sc ul { margin: 0; padding-left: 18px; font-size: 14px; font-weight: 600; }
    .verdict { font-size: 13px; padding-left: 10px; border-left: 3px solid var(--ln); }
    .verdict.v-ok { border-left-color: var(--ok); }
    .verdict.v-warn { border-left-color: var(--wn); }
    .sc .acts { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; font-weight: 600; }
    .linkbtn { border: 0; background: none; padding: 0; font: inherit; color: var(--pl); cursor: pointer; text-decoration: underline; }
    .linkbtn.mu { color: var(--mu); }
    .more { font-size: 13px; font-weight: 600; }
    .gc { font-size: 13px; padding-left: 10px; border-left: 3px solid var(--wn); }
  `,
  template: `
    @if (view(); as v) {
      <section class="stack" style="gap: 8px">
        <h2 class="h2">À venir</h2>
        @if (tasks().length) {
          <div class="card" style="padding: 2px 0">
            @for (t of tasks(); track t.id) {
              <div class="t">
                <a class="tic" [class.p]="plant(t.type)" [routerLink]="['/bacs', v.tank.id, 'taches', t.id]" [attr.aria-label]="'Modifier ' + t.label">
                  <app-icon [name]="icon(t.type)" [size]="20" />
                </a>
                <div class="grow">
                  <a class="tn" [routerLink]="['/bacs', v.tank.id, 'taches', t.id]">{{ t.label }}</a>
                  <p class="sub">
                    {{ freq(t.everyDays) }} ·
                    <span [class.today]="t.nextDue === store.today()" [class.late]="t.nextDue < store.today()">{{ due(t.nextDue, store.today()) }}</span>
                  </p>
                </div>
                <button class="done" [class.late]="t.nextDue < store.today()" (click)="done(t)" [attr.aria-label]="t.label + ' : fait'">
                  <app-icon name="check" [size]="20" [stroke]="2.2" />
                </button>
              </div>
            }
          </div>
        } @else {
          <p class="card empty">Aucune tâche récurrente.</p>
        }
      </section>

      <section class="stack" style="gap: 8px">
        <div class="row between">
          <h2 class="h2">Matériel</h2>
          <a class="more" routerLink="/materiel/equipement/nouveau" [queryParams]="{ bac: v.tank.id }">Ajouter</a>
        </div>
        @for (c of checks(); track c.title) {
          <p class="gc"><b>{{ c.title }}</b> — {{ c.detail }}</p>
        }
        @if (gear().length) {
          <div class="card">
            @for (e of gear(); track e.id) {
              <a class="li" [routerLink]="['/materiel/equipement', e.id]">
                <app-icon [name]="gearIcon(e.type)" [size]="20" style="color: var(--mu)" />
                <div class="grow">
                  <p style="font-weight: 600">{{ e.name }}</p>
                  <p class="sub">{{ gearTypes[e.type] }}{{ gearSummary(e) ? ' · ' + gearSummary(e) : '' }}</p>
                </div>
                <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
              </a>
            }
          </div>
        } @else {
          <p class="sub" style="margin: 0">Aucun équipement rattaché à ce bac.</p>
        }
      </section>

      @if (settings().length) {
        <section class="stack" style="gap: 8px">
          <h2 class="h2">Réglages du matériel</h2>
          <p class="sub" style="margin: 0">Algues signalées dans les bilans visuels 30 jours avant et après chaque changement.</p>
          <div class="card">
            @for (g of settings(); track g.key) {
              <article class="sc">
                <div class="row between">
                  <p><b>{{ g.equipmentName }}</b></p>
                  <span class="sub" style="margin: 0">{{ date(g.date) }}</span>
                </div>
                <ul>@for (c of g.changes; track c.id) { <li>{{ describe(c) }}</li> }</ul>
                @if (g.note) { <p class="sub" style="margin: 0">{{ g.note }}</p> }
                <p class="verdict" [class.v-ok]="g.verdict.level === 'ok'" [class.v-warn]="g.verdict.level === 'warn'">{{ g.verdict.text }}</p>
                <div class="acts">
                  @if (g.effect.photoBefore && g.effect.photoAfter) {
                    <button class="linkbtn" type="button" (click)="compare.set([g.effect.photoBefore.id, g.effect.photoAfter.id])">Comparer les photos avant / après</button>
                  } @else if (g.effect.photoBefore) {
                    <span class="sub" style="margin: 0">Prends une photo du bac pour comparer avec avant.</span>
                  }
                  <button class="linkbtn mu" type="button" (click)="removeSetting(g.changes)">Supprimer</button>
                </div>
              </article>
            }
          </div>
        </section>
      }

      <section class="stack">
        <h2 class="h2">Historique</h2>
        @if (history().length) {
          <div class="tl">
            @for (h of history(); track h.id) {
              <div class="ev" [class.w]="!h.plant">
                <p>{{ h.title }}</p>
                <p class="sub">{{ date(h.date) }}{{ h.note ? ' · ' + h.note : '' }}</p>
              </div>
            }
          </div>
        } @else {
          <p class="sub">Rien pour l’instant.</p>
        }
      </section>
      @if (compare(); as pair) {
        <app-photo-compare [photos]="tankPhotos()" [tankId]="v.tank.id" [initialFirst]="pair[0]" [initialSecond]="pair[1]" (closed)="compare.set(null)" />
      }
      @if (waterChange(); as t) {
        <app-water-change-sheet [task]="t" (closed)="waterChange.set(null)" />
      }
      <a class="fab" [routerLink]="['/bacs', v.tank.id, 'taches', 'nouvelle']"><app-icon name="plus" [size]="20" [stroke]="2.2" />Tâche</a>
    }
  `,
})
export class MaintenanceTab {
  protected readonly store = inject(AquariumStore);
  readonly id = input.required<string>();

  protected readonly icon = taskIcon;
  protected readonly plant = isPlantTask;
  protected readonly freq = frequencyLabel;
  protected readonly due = dueLabel;
  protected readonly date = fmtShortDate;

  protected readonly waterChange = signal<MaintenanceTask | null>(null);
  protected readonly compare = signal<[string, string] | null>(null);
  protected readonly describe = describeChange;
  protected readonly gearIcon = equipmentIcon;
  protected readonly gearSummary = equipmentSummary;
  protected readonly gearTypes = EQUIPMENT_TYPES;

  protected readonly gear = computed(() => this.store.equipment().filter((e) => e.tankId === this.id()));
  /** Points d'attention sur le matériel du bac (éclairage long, brassage faible…). */
  protected readonly checks = computed(() => {
    const t = this.view()?.tank;
    return t ? gearChecks(t, this.gear()).filter((c) => c.level === 'warn') : [];
  });

  protected readonly tankPhotos = computed(() => this.store.photos().filter((p) => p.tankId === this.id() && !p.inhabitantId));

  /** Changements de réglages du bac, regroupés par enregistrement, du plus récent au plus ancien. */
  protected readonly settings = computed(() => {
    const groups = new Map<string, SettingChange[]>();
    for (const c of this.store.settingChanges().filter((c) => c.tankId === this.id())) {
      const key = c.equipmentId + c.date;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const list = [...groups.entries()].map(([key, changes]) => ({ key, changes, ...changes[0] }));
    const now = new Date();
    return list
      .map((g) => {
        const next = list.find((o) => o.equipmentId === g.equipmentId && o.date > g.date && o.changes.some((c) => g.changes.some((d) => d.field === c.field)));
        const effect = changeEffect(g.changes[0], this.store.observations(), this.store.photos(), now, next?.date);
        return { ...g, effect, verdict: effectVerdict(effect) };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  protected async removeSetting(changes: SettingChange[]): Promise<void> {
    if (!confirm('Retirer ce changement de l’historique ?')) return;
    for (const c of changes) await this.store.deleteSettingChange(c.id);
  }

  protected done(task: MaintenanceTask): void {
    if (task.type === 'water_change') this.waterChange.set(task);
    else this.store.completeTask(task);
  }

  protected readonly view = computed(() => this.store.tankViews().find((v) => v.tank.id === this.id()));
  protected readonly tasks = computed(() => this.view()?.tasks ?? []);

  /** Opérations d'entretien et événements des habitants (taille, bouture…) dans une seule chronologie. */
  protected readonly history = computed(() => {
    const id = this.id();
    const byId = this.store.speciesById();
    const inhabitants = new Map(this.store.inhabitants().map((i) => [i.id, i]));
    const logs = this.store.logs()
      .filter((l) => l.tankId === id)
      .map((l) => ({ id: l.id, date: l.date, title: l.label, note: l.note, plant: isPlantTask(l.type) }));
    const events = this.store.inhabitantEvents()
      .filter((e) => e.tankId === id)
      .map((e) => {
        const sp = byId.get(inhabitants.get(e.inhabitantId)?.speciesId ?? '');
        const delta = e.quantityDelta ? ` (${e.quantityDelta > 0 ? '+' : ''}${e.quantityDelta})` : '';
        return { id: e.id, date: e.date, title: `${EVENT_LABELS[e.type]} — ${speciesName(sp)}${delta}`, note: e.note, plant: sp?.kind === 'plant' };
      });
    return [...logs, ...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  });
}
