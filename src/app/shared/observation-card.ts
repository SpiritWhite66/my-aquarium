import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { Observation } from '../core/models';
import { CONFIDENCE_LABELS, FINDING_CATEGORIES, OVERALL_LABELS } from '../core/ai-import';
import { fmtShortDate } from '../core/labels';
import { Icon } from './icon';
import { CareRepo } from '../core/data/care.repo';

/** Dernier bilan visuel d'un bac : constats à cocher une fois traités. */
@Component({
  selector: 'app-observation-card',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .f { display: flex; gap: 10px; align-items: flex-start; padding-top: 10px; border-top: 1px solid var(--ln); }
    .f.done { opacity: .5; }
    .f.done .t { text-decoration: line-through; }
    .f input { width: 22px; height: 22px; accent-color: var(--pl); flex: none; margin-top: 2px; }
    .t { font-weight: 700; font-size: 14px; }
    .sev { width: 8px; height: 8px; border-radius: 4px; flex: none; margin-top: 8px; }
    ul { margin: 4px 0 0; padding-left: 18px; font-size: 13px; color: var(--mu); }
    .more { border: 0; background: none; color: var(--pl); font: 600 13px var(--font); cursor: pointer; padding: 0; align-self: flex-start; }
  `,
  template: `
    @let o = observation();
    <section class="card" [class.warn]="o.overall === 'watch'" [class.danger]="o.overall === 'problem'">
      <div class="row between">
        <h2 class="h2"><app-icon [name]="observation().manual ? 'leaves' : 'search'" [size]="18" />{{ observation().manual ? 'Algues' : 'Bilan visuel' }}</h2>
        <span class="pill" [class.ok]="o.overall === 'good'" [class.wn]="o.overall === 'watch'" [class.dg]="o.overall === 'problem'">
          <span class="dot"></span>{{ overall[o.overall] }}
        </span>
      </div>
      <p class="sub" style="margin: 0">{{ date(o.date) }}{{ o.source ? ' · ' + o.source : '' }}</p>
      @if (o.summary) {
        <p style="font-size: 14px">{{ o.summary }}</p>
      }
      @for (f of visible(); track f.i) {
        <div class="f" [class.done]="f.resolved">
          <input type="checkbox" [checked]="f.resolved" (change)="careRepo.setFindingResolved(o, f.i, $any($event.target).checked)"
            [attr.aria-label]="'Traité : ' + f.title" />
          <div class="grow">
            <p class="lbl">{{ categories[f.category] }} · {{ conf[f.confidence] }}</p>
            <p class="t">{{ f.title }}</p>
            @if (f.detail) { <p class="sub">{{ f.detail }}</p> }
            @if (f.likelyCause) { <p class="sub"><b>Cause probable :</b> {{ f.likelyCause }}</p> }
            @if (f.advice?.length && !f.resolved) {
              <ul>
                @for (a of f.advice; track $index) { <li>{{ a }}</li> }
              </ul>
            }
          </div>
          <span class="sev" [style.background]="f.severity === 'danger' ? 'var(--dg)' : f.severity === 'warn' ? 'var(--wn)' : 'var(--ok)'"></span>
        </div>
      }
      @if (hidden() > 0) {
        <button class="more" type="button" (click)="showAll.set(true)">Voir {{ hidden() }} constat{{ hidden() > 1 ? 's' : '' }} traité{{ hidden() > 1 ? 's' : '' }}</button>
      }
    </section>
  `,
})
export class ObservationCard {
  protected readonly careRepo = inject(CareRepo);
  readonly observation = input.required<Observation>();

  protected readonly overall = OVERALL_LABELS;
  protected readonly categories = FINDING_CATEGORIES;
  protected readonly conf = CONFIDENCE_LABELS;
  protected readonly date = fmtShortDate;
  protected readonly showAll = signal(false);

  private readonly all = computed(() => this.observation().findings.map((f, i) => ({ ...f, i })));
  protected readonly visible = computed(() => (this.showAll() ? this.all() : this.all().filter((f) => !f.resolved)));
  protected readonly hidden = computed(() => this.all().length - this.visible().length);
}
