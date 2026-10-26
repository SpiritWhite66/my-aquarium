import { Injectable, inject } from '@angular/core';
import { AQUARIUM_DB } from '../db';
import { Clock } from '../clock';
import { newId, now, nowPlus, type New } from './util';
import { addDays } from '../dates';
import { DOSE_UNITS } from '../labels';
import type {
  DoseUnit,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  Diagnosis,
  WaterTest,
} from '../models';

/** Suivi du bac : relevés, tâches et journal d'entretien, engrais, diagnostics, bilans visuels. */
@Injectable({ providedIn: 'root' })
export class CareRepo {
  private readonly db = inject(AQUARIUM_DB);
  private readonly clock = inject(Clock);

  async addWaterTest(test: New<WaterTest>): Promise<void> {
    const today = this.clock.today();
    await this.db.transaction(
      'rw',
      [this.db.waterTests, this.db.tasks, this.db.logs, this.db.diagnoses],
      async () => {
        await this.db.waterTests.put({
          ...test,
          id: test.id ?? newId(),
          updatedAt: now(),
        } as WaterTest);
        // Un relevé valide la tâche « Test de l'eau » du bac si elle est due.
        const tasks = await this.db.tasks.where('tankId').equals(test.tankId).toArray();
        const due = tasks.find((t) => t.type === 'water_test' && t.active && t.nextDue <= today);
        if (due) await this.completeTask(due, 'Relevé ajouté');
      },
    );
  }

  async deleteWaterTest(id: string): Promise<void> {
    await this.db.waterTests.delete(id);
  }

  async updateWaterTest(test: WaterTest): Promise<void> {
    await this.db.waterTests.put({ ...test, updatedAt: now() });
  }

  async saveTask(task: New<MaintenanceTask>): Promise<void> {
    await this.db.tasks.put({
      ...task,
      id: task.id ?? newId(),
      updatedAt: now(),
    } as MaintenanceTask);
  }

  async deleteTask(id: string): Promise<void> {
    await this.db.tasks.delete(id);
  }

  async completeTask(
    task: MaintenanceTask,
    note?: string,
    details?: MaintenanceLog['details'],
  ): Promise<void> {
    await this.completeTaskWith(task, [{ label: task.label, note, details }]);
  }

  /** Doses d'engrais (une ligne par produit), en validant la tâche si elle est fournie. */
  async logDoses(
    tankId: string,
    doses: { product: string; amount?: number; unit?: DoseUnit; consumableId?: string }[],
    task?: MaintenanceTask,
    note?: string,
  ): Promise<void> {
    const entries = doses.map((d) => ({
      label: `Engrais — ${d.product}${d.amount != null ? ` ${String(d.amount).replace('.', ',')} ${DOSE_UNITS[d.unit ?? 'ml']}` : ''}`,
      note,
      details: { product: d.product, amount: d.amount, unit: d.unit, consumableId: d.consumableId },
    }));
    if (task) return this.completeTaskWith(task, entries, 'fertilize');
    await this.db.logs.bulkPut(
      entries.map((e, i) => ({
        ...e,
        id: newId(),
        updatedAt: now(),
        tankId,
        type: 'fertilize' as const,
        date: nowPlus(i),
      })),
    );
  }

  private async completeTaskWith(
    task: MaintenanceTask,
    entries: Pick<MaintenanceLog, 'label' | 'note' | 'details'>[],
    type = task.type,
  ): Promise<void> {
    const today = this.clock.today();
    await this.db.transaction('rw', [this.db.tasks, this.db.logs, this.db.diagnoses], async () => {
      await this.db.logs.bulkPut(
        entries.map((e, i) => ({
          ...e,
          id: newId(),
          updatedAt: now(),
          tankId: task.tankId,
          taskId: task.id,
          type,
          date: nowPlus(i),
        })),
      );
      await this.db.tasks.update(
        task.id,
        task.oneOff
          ? { active: false, updatedAt: now() }
          : { nextDue: addDays(today, task.everyDays), updatedAt: now() },
      );
      // Tâche issue d'un diagnostic : l'action correspondante est marquée faite.
      const diag =
        task.diagnosisId && task.oneOff ? await this.db.diagnoses.get(task.diagnosisId) : undefined;
      if (diag) {
        const actions = diag.actions.map((a) => (a.taskId === task.id ? { ...a, done: true } : a));
        await this.db.diagnoses.update(diag.id, { actions, updatedAt: now() });
      }
    });
  }

  /** Mode vacances : les tâches dues avant le retour sont décalées au jour du retour. */
  async postponeTasks(until: string): Promise<number> {
    const late = (await this.db.tasks.toArray()).filter((t) => t.active && t.nextDue < until);
    await this.db.tasks.bulkUpdate(
      late.map((t) => ({ key: t.id, changes: { nextDue: until, updatedAt: now() } })),
    );
    return late.length;
  }

  async addLog(log: New<MaintenanceLog>): Promise<void> {
    await this.db.logs.put({ ...log, id: log.id ?? newId(), updatedAt: now() } as MaintenanceLog);
  }

  /** Enregistre un diagnostic ; les actions cochées deviennent des tâches. */
  async addDiagnosis(d: New<Diagnosis>, createTasks: boolean[]): Promise<string> {
    const id = d.id ?? newId();
    const today = this.clock.today();
    const tasks: MaintenanceTask[] = [];
    const actions = d.actions.map((a, i) => {
      if (!a.task || !createTasks[i]) return a;
      const taskId = newId();
      tasks.push({
        id: taskId,
        updatedAt: now(),
        tankId: d.tankId,
        type: a.task.type,
        label: a.task.label,
        everyDays: a.task.everyDays ?? 7,
        nextDue: addDays(today, a.task.inDays ?? 0),
        active: true,
        oneOff: !a.task.everyDays,
        diagnosisId: id,
      });
      return { ...a, taskId };
    });
    await this.db.transaction('rw', [this.db.tasks, this.db.diagnoses], async () => {
      await this.db.tasks.bulkPut(tasks);
      await this.db.diagnoses.put({ ...d, id, actions, updatedAt: now() } as Diagnosis);
    });
    return id;
  }

  async setActionDone(d: Diagnosis, index: number, done: boolean): Promise<void> {
    const actions = d.actions.map((a, i) => (i === index ? { ...a, done } : a));
    await this.db.diagnoses.update(d.id, { actions, updatedAt: now() });
  }

  async deleteDiagnosis(id: string): Promise<void> {
    await this.db.diagnoses.delete(id);
  }

  async addObservation(o: New<Observation>): Promise<void> {
    await this.db.observations.put({ ...o, id: o.id ?? newId(), updatedAt: now() } as Observation);
  }

  async setFindingResolved(o: Observation, index: number, resolved: boolean): Promise<void> {
    const findings = o.findings.map((f, i) => (i === index ? { ...f, resolved } : f));
    await this.db.observations.update(o.id, { findings, updatedAt: now() });
  }

  async deleteObservation(id: string): Promise<void> {
    await this.db.observations.delete(id);
  }
}
