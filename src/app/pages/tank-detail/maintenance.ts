import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { dueLabel, fmtShortDate, frequencyLabel, speciesName } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { isPlantTask, taskIcon } from '../../shared/visuals';

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
  imports: [RouterLink, Icon],
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
                <button class="done" [class.late]="t.nextDue < store.today()" (click)="store.completeTask(t)" [attr.aria-label]="t.label + ' : fait'">
                  <app-icon name="check" [size]="20" [stroke]="2.2" />
                </button>
              </div>
            }
          </div>
        } @else {
          <p class="card empty">Aucune tâche récurrente.</p>
        }
      </section>

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
