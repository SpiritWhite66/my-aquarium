import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { AQUARIUM_DB } from './db';
import { RefSyncService } from './ref-sync';
import { Clock } from './clock';
import type { Inhabitant, MaintenanceTask, Observation, Species, Tank, WaterTest } from './models';
import {
  PARAM_BY_KEY,
  compatibilityIssues,
  isAlive,
  testAlerts,
  worst,
  type Issue,
  type Level,
  type ParamAlert,
} from './rules';
import { liveSignal } from './stores/live';
import { CareStore } from './stores/care.store';
import { PopulationStore } from './stores/population.store';
import { SpeciesStore } from './stores/species.store';
import { WaterStore } from './stores/water.store';
import { must } from './assert';

export interface TankView {
  tank: Tank;
  members: { inhabitant: Inhabitant; species: Species }[];
  plants: { inhabitant: Inhabitant; species: Species }[];
  fauna: { inhabitant: Inhabitant; species: Species }[];
  tests: WaterTest[]; // du plus ancien au plus récent
  lastTest?: WaterTest;
  alerts: ParamAlert[];
  issues: Issue[];
  level: Level;
  statusLabel: string;
  tasks: MaintenanceTask[];
  /** Dernier bilan visuel (IA) et ses constats non résolus. */
  lastObservation?: Observation;
  openFindings: Observation['findings'];
}

/** Regroupe une liste par bac en gardant l'ordre d'origine. */
export function groupByTank<T extends { tankId: string }>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const group = out.get(item.tankId);
    if (group) group.push(item);
    else out.set(item.tankId, [item]);
  }
  return out;
}

export interface DueTask {
  task: MaintenanceTask;
  tank: Tank;
}

/**
 * Vues calculées sur plusieurs domaines (état de chaque bac, tâches dues). Chaque table est lue par
 * le store de son domaine (`core/stores/`), tenu à jour par Dexie. Les écritures passent par les repositories de `core/data/`.
 * Pour le futur backend, ce sont ces deux couches qui changeront, pas les écrans.
 */
@Injectable({ providedIn: 'root' })
export class AquariumStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);
  private readonly speciesStore = inject(SpeciesStore);
  private readonly refSync = inject(RefSyncService);
  private readonly populationStore = inject(PopulationStore);
  private readonly waterStore = inject(WaterStore);
  private readonly careStore = inject(CareStore);

  readonly ready = signal(false);
  /** Jour local courant (YYYY-MM-DD). */
  readonly today = inject(Clock).today.asReadonly();

  readonly tanks = liveSignal(this.destroyRef, () => this.db.tanks.toArray(), []);

  readonly activeTanks = computed(() =>
    this.tanks()
      .filter((t) => !t.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  );

  readonly tankViews = computed<TankView[]>(() => {
    const byId = this.speciesStore.speciesById();
    const inhabitants = this.populationStore.inhabitants();
    const tests = this.waterStore.waterTests();
    const tasks = this.careStore.tasks();
    const observations = this.careStore.observations();
    // Un seul passage par liste, au lieu d'un filtre complet par bac.
    const inhabitantsOf = groupByTank(inhabitants);
    const testsOf = groupByTank(tests);
    const tasksOf = groupByTank(tasks);
    const observationsOf = groupByTank(observations);
    return this.activeTanks().map((tank) => {
      const members = (inhabitantsOf.get(tank.id) ?? [])
        .filter((i) => isAlive(i) && byId.has(i.speciesId))
        .map((inhabitant) => ({ inhabitant, species: must(byId.get(inhabitant.speciesId)) }))
        .sort((a, b) => a.species.scientificName.localeCompare(b.species.scientificName));
      const species = members.map((m) => m.species);
      const tankTests = testsOf.get(tank.id) ?? [];
      const lastTest = tankTests.at(-1);
      const alerts = testAlerts(lastTest, species, tank);
      const issues = compatibilityIssues(
        tank,
        members.map((m) => ({ species: m.species, quantity: m.inhabitant.quantity })),
      );
      const lastObservation = observationsOf.get(tank.id)?.at(-1);
      const openFindings = (lastObservation?.findings ?? []).filter(
        (f) => !f.resolved && f.severity !== 'info',
      );
      const level = worst([
        ...alerts.map((a) => a.level),
        ...openFindings.map((f) => (f.severity === 'danger' ? 'danger' : 'warn') as Level),
      ]);
      const first = alerts.at(0);
      const statusLabel = first
        ? `${PARAM_BY_KEY[first.key].short} ${first.direction === 'high' ? 'élevé' : 'bas'}`
        : openFindings.length
          ? 'Bilan visuel'
          : 'OK';
      return {
        tank,
        members,
        plants: members.filter((m) => m.species.kind === 'plant'),
        fauna: members.filter((m) => m.species.kind !== 'plant'),
        tests: tankTests,
        lastTest,
        alerts,
        issues,
        level,
        statusLabel,
        tasks: (tasksOf.get(tank.id) ?? []).filter((t) => t.active),
        lastObservation,
        openFindings,
      };
    });
  });

  /** Tâches dues aujourd'hui ou en retard, tous bacs confondus. */
  readonly dueTasks = computed<DueTask[]>(() => {
    const today = this.today();
    const tanks = new Map(this.activeTanks().map((t) => [t.id, t]));
    return this.careStore
      .tasks()
      .filter((t) => t.active && t.nextDue <= today && tanks.has(t.tankId))
      .map((task) => ({ task, tank: must(tanks.get(task.tankId)) }));
  });

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    // Met à jour les fiches du catalogue intégré sans toucher aux fiches personnelles.
    await this.refSync.seedCatalog();
    this.ready.set(true);
    // Catalogue en ligne : seulement si le réglage est activé ; ne bloque jamais le démarrage.
    void this.refSync.sync();
  }
}
