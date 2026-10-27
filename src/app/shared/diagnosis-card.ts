import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Diagnosis } from '../core/models';
import { AquariumStore } from '../core/store';
import { addDays, daysBetween, localDay } from '../core/dates';
import { fmtShortDate } from '../core/labels';
import { Icon } from './icon';
import { CareRepo } from '../core/data/care.repo';

/** Dernier diagnostic IA d'un bac : conclusion, plan d'action à cocher, date du suivi. */
@Component({
  selector: 'app-diagnosis-card',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card { padding: 14px; display: flex; flex-direction: column; gap: 10px; border-color: var(--wa); }
    .a { display: flex; gap: 10px; align-items: flex-start; padding-top: 8px; border-top: 1px solid var(--ln); }
    .a input { width: 22px; height: 22px; accent-color: var(--pl); flex: none; margin-top: 2px; }
    .a.done { opacity: .55; }
    .a.done .t { text-decoration: line-through; }
    .t { font-weight: 600; font-size: 14px; }
    .hyp { font-size: 14px; }
    .follow { font-size: 13px; font-weight: 600; color: var(--wa); }
    .follow.due { color: var(--wn); }
  `,
  template: `
    @let d = diagnosis();
    <section class="card">
      <div class="row between">
        <h2 class="h2"><app-icon name="search" [size]="18" />Diagnostic IA</h2>
        <span class="sub" style="margin: 0">{{ date(d.date) }}</span>
      </div>
      @if (d.question) { <p class="sub" style="margin: 0">« {{ d.question }} »</p> }
      <p style="font-size: 14px">{{ d.summary }}</p>
      @if (d.hypotheses[0]; as h) { <p class="hyp"><b>Cause principale :</b> {{ h.title }}</p> }
      @for (a of d.actions; track $index; let i = $index) {
        <div class="a" [class.done]="a.done">
          <input type="checkbox" [checked]="!!a.done" (change)="careRepo.setActionDone(d, i, $any($event.target).checked)" [attr.aria-label]="'Fait : ' + a.title" />
          <div class="grow">
            <p class="t">{{ a.title }}</p>
            @if (a.detail && !a.done) { <p class="sub">{{ a.detail }}</p> }
            @if (a.taskId) { <p class="sub">Tâche créée dans Entretien</p> }
          </div>
        </div>
      }
      @if (followUp(); as f) {
        <p class="follow" [class.due]="f.days <= 0">
          {{ f.days <= 0 ? 'Suivi à faire' : 'Suivi le ' + date(f.date) }}{{ f.measure ? ' · mesurer ' + f.measure : '' }}
        </p>
      }
      <div class="row" style="gap: 8px; flex-wrap: wrap">
        <a class="btn ton" routerLink="/diagnostic" [queryParams]="{ bac: d.tankId }"><app-icon name="search" [size]="18" />{{ d.followUp ? 'Faire le suivi' : 'Nouveau diagnostic' }}</a>
      </div>
    </section>
  `,
})
export class DiagnosisCard {
  protected readonly store = inject(AquariumStore);
  protected readonly careRepo = inject(CareRepo);
  protected readonly date = fmtShortDate;
  readonly diagnosis = input.required<Diagnosis>();

  protected readonly followUp = computed(() => {
    const d = this.diagnosis();
    if (!d.followUp) return undefined;
    const date = addDays(localDay(d.date), d.followUp.inDays);
    return {
      date,
      days: daysBetween(this.store.today(), date),
      measure: d.followUp.measure?.join(', '),
    };
  });
}
