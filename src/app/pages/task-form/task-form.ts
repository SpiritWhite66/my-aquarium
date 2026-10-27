import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { AquariumStore } from '../../core/store';
import { CareStore } from '../../core/stores/care.store';
import type { MaintenanceTask, TaskType } from '../../core/models';
import { TASK_TYPES, parseNumber } from '../../core/labels';
import { addDays } from '../../core/dates';
import { Icon } from '../../shared/icon';
import { fromEntity } from '../../shared/form-state';
import { CareRepo } from '../../core/data/care.repo';
import { must } from '../../core/assert';

@Component({
  selector: 'app-task-form',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" style="max-width: 640px">
      <header class="top" style="justify-content: flex-start">
        <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
        <div class="grow">
          <h1 class="h1">{{ taskId() ? 'Modifier la tâche' : 'Nouvelle tâche' }}</h1>
          <p class="sub">{{ tankName() }}</p>
        </div>
      </header>
      <form class="stack" style="gap: 16px" (submit)="$event.preventDefault(); save()">
        <div class="form-grid">
          <div class="field full">
            <label for="type">Type</label>
            <select id="type" (change)="setType($any($event.target).value)">
              @for (t of typeList; track t[0]) {
                <option [value]="t[0]" [selected]="t[0] === type()">{{ t[1] }}</option>
              }
            </select>
          </div>
          <div class="field full">
            <label for="label">Libellé</label>
            <input id="label" [value]="label()" (input)="label.set($any($event.target).value)" />
          </div>
          <div class="field">
            <label for="every">Tous les… (jours)</label>
            <input id="every" class="num" inputmode="numeric" [value]="every()" (input)="every.set($any($event.target).value)" />
          </div>
          <div class="field">
            <label for="next">Prochaine fois</label>
            <input id="next" type="date" [value]="nextDue()" (input)="nextDue.set($any($event.target).value)" />
          </div>
        </div>
        <div class="row" style="flex-wrap: wrap; gap: 8px">
          <button class="btn fill" type="submit" [disabled]="!valid()">Enregistrer</button>
          @if (taskId()) {
            <button class="btn danger" type="button" (click)="remove()"><app-icon name="trash" [size]="18" />Supprimer</button>
          }
        </div>
      </form>
    </div>
  `,
})
export class TaskFormPage {
  private readonly store = inject(AquariumStore);
  private readonly careStore = inject(CareStore);
  protected readonly careRepo = inject(CareRepo);
  protected readonly location = inject(Location);

  readonly id = input.required<string>();
  readonly taskId = input<string>();

  protected readonly typeList = Object.entries(TASK_TYPES) as [TaskType, string][];
  private readonly existing = computed(() => this.careStore.tasks().find((t) => t.id === this.taskId()));
  protected readonly type = fromEntity<MaintenanceTask, TaskType>(this.existing, (t) => t.type, 'water_change');
  protected readonly label = fromEntity(this.existing, (t) => t.label, TASK_TYPES.water_change);
  protected readonly every = fromEntity(this.existing, (t) => String(t.everyDays), '7');
  protected readonly nextDue = fromEntity(this.existing, (t) => t.nextDue, addDays(this.store.today(), 7));

  protected readonly tankName = computed(() => this.store.tanks().find((t) => t.id === this.id())?.name ?? '');
  protected readonly valid = computed(() => this.label().trim() && (parseNumber(this.every()) ?? 0) >= 1 && this.nextDue());

  protected setType(type: TaskType): void {
    // Le libellé suit le type tant qu'il n'a pas été personnalisé.
    if (Object.values(TASK_TYPES).includes(this.label())) this.label.set(TASK_TYPES[type]);
    this.type.set(type);
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    await this.careRepo.saveTask({
      id: this.taskId(),
      tankId: this.id(),
      type: this.type(),
      label: this.label().trim(),
      everyDays: Math.round(must(parseNumber(this.every()))),
      nextDue: this.nextDue(),
      active: true,
    });
    this.location.back();
  }

  protected async remove(): Promise<void> {
    if (!confirm('Supprimer cette tâche ?')) return;
    await this.careRepo.deleteTask(must(this.taskId()));
    this.location.back();
  }
}
