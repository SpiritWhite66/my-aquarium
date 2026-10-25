import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { PARAM_BY_KEY } from '../../core/rules';
import { TANK_TYPES, dueLabel, fmt, fmtLongDate, fmtRange } from '../../core/labels';
import { parseIsoDate } from '../../core/dates';
import { Icon } from '../../shared/icon';
import { TankCard } from '../../shared/tank-card';
import { BackupService } from '../../core/backup';
import { WaterChangeSheet } from '../../shared/water-change-sheet';
import type { MaintenanceTask } from '../../core/models';
import { idealRange } from '../../core/rules';
import { stockAlerts, trendOf } from '../../core/insights';

@Component({
  selector: 'app-home',
  imports: [RouterLink, Icon, TankCard, WaterChangeSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  protected readonly store = inject(AquariumStore);
  protected readonly backup = inject(BackupService);
  protected readonly dueLabel = dueLabel;
  protected readonly types = TANK_TYPES;

  protected readonly dateLabel = computed(() => fmtLongDate(parseIsoDate(this.store.today())));

  /** Alertes de tous les bacs : paramètres hors plage puis problèmes de cohabitation. */
  protected readonly alerts = computed(() =>
    this.store.tankViews().flatMap((v) => [
      // Pendant le cyclage, les pics de NH4 et NO2 sont attendus : on ne les signale que s'il y a des animaux.
      ...v.alerts.filter((a) => !(v.tank.cycling && !v.fauna.length && (a.key === 'nh4' || a.key === 'no2'))).map((a) => {
        const p = PARAM_BY_KEY[a.key];
        return {
          tankId: v.tank.id,
          level: a.level,
          title: `${p.short} à ${fmt(a.value)}${p.unit ? ' ' + p.unit : ''} — ${v.tank.name}`,
          detail: `Plage idéale ${fmtRange(a.range.min, a.range.max, p.unit)}.${a.level === 'danger' && p.toxic ? ' Changement d’eau conseillé.' : ''}`,
          link: 'eau',
        };
      }),
      // Tendance : les nitrates vont dépasser la plage dans la semaine.
      ...(() => {
        const range = idealRange('no3', v.members.map((m) => m.species), v.tank);
        const t = trendOf(v.tests, 'no3', range);
        if (!t || t.limit !== 'max' || t.daysToLimit == null || t.daysToLimit > 7 || v.alerts.some((a) => a.key === 'no3')) return [];
        return [{
          tankId: v.tank.id,
          level: 'warn' as const,
          title: `Nitrates en hausse — ${v.tank.name}`,
          detail: `+${fmt(t.perWeek)} mg/L par semaine : ${fmt(range!.max)} mg/L atteints dans ~${t.daysToLimit} j. Prévois un changement d’eau.`,
          link: 'eau',
        }];
      })(),
      ...v.openFindings.map((f) => ({
        tankId: v.tank.id,
        level: f.severity === 'danger' ? ('danger' as const) : ('warn' as const),
        title: `${f.title} — ${v.tank.name}`,
        detail: f.advice?.[0] ?? f.detail ?? 'Constat du dernier bilan visuel.',
        link: 'population',
      })),
      ...v.issues.map((i) => ({
        tankId: v.tank.id,
        level: i.level,
        title: `${i.title} — ${v.tank.name}`,
        detail: i.detail,
        link: 'population',
      })),
    ]),
  );

  protected readonly waterChange = signal<MaintenanceTask | null>(null);

  protected done(task: MaintenanceTask): void {
    if (task.type === 'water_change') this.waterChange.set(task);
    else this.store.completeTask(task);
  }

  protected readonly stock = computed(() =>
    stockAlerts(this.store.consumables(), this.store.equipment(), this.store.today()).filter((a) => a.level !== 'info'),
  );

  protected readonly lateCount = computed(
    () => this.store.dueTasks().filter((d) => d.task.nextDue < this.store.today()).length,
  );

  protected readonly readingLink = computed(() => {
    const tanks = this.store.tankViews();
    return tanks.length === 1 ? { bac: tanks[0].tank.id } : {};
  });
}
