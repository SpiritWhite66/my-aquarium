import { DestroyRef, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { liveQuery } from 'dexie';
import { AQUARIUM_DB } from './db';
import { BUILTIN_SPECIES } from './catalog';
import { Clock } from './clock';
import type { Inhabitant, MaintenanceTask, Observation, Species, Tank, WaterTest } from './models';
import { PARAM_BY_KEY, compatibilityIssues, isAlive, testAlerts, worst, type Issue, type Level, type ParamAlert } from './rules';
import { DEFAULT_PREFS } from './reminders';

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

export interface DueTask {
  task: MaintenanceTask;
  tank: Tank;
}

/**
 * Lecture des données : chaque table en signal, tenu à jour par Dexie, et les vues calculées
 * (état de chaque bac, tâches dues). Les écritures passent par les repositories de `core/data/`.
 * Pour le futur backend, ce sont ces deux couches qui changeront, pas les écrans.
 */
@Injectable({ providedIn: 'root' })
export class AquariumStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly ready = signal(false);
  /** Jour local courant (YYYY-MM-DD). */
  readonly today = inject(Clock).today.asReadonly();

  readonly tanks = this.live(() => this.db.tanks.toArray(), []);
  readonly species = this.live(() => this.db.species.toArray(), []);
  readonly inhabitants = this.live(() => this.db.inhabitants.toArray(), []);
  readonly inhabitantEvents = this.live(() => this.db.inhabitantEvents.orderBy('date').reverse().toArray(), []);
  readonly waterTests = this.live(() => this.db.waterTests.orderBy('date').toArray(), []);
  readonly tasks = this.live(() => this.db.tasks.orderBy('nextDue').toArray(), []);
  readonly logs = this.live(() => this.db.logs.orderBy('date').reverse().toArray(), []);
  readonly observations = this.live(() => this.db.observations.orderBy('date').toArray(), []);
  /** Photos, de la plus récente à la plus ancienne. */
  readonly photos = this.live(() => this.db.photos.orderBy('date').reverse().toArray(), []);
  readonly equipment = this.live(() => this.db.equipment.toArray(), []);
  readonly consumables = this.live(() => this.db.consumables.toArray(), []);
  /** Mesures CO2, de la plus ancienne à la plus récente. */
  readonly co2Readings = this.live(() => this.db.co2Readings.orderBy('date').toArray(), []);
  /** Diagnostics IA, du plus ancien au plus récent. */
  readonly diagnoses = this.live(() => this.db.diagnoses.orderBy('date').toArray(), []);
  /** Préférences de notification de cet appareil (non incluses dans les sauvegardes). */
  readonly notificationPrefs = this.live(async () => (await this.db.prefs.get('notifications')) ?? DEFAULT_PREFS, DEFAULT_PREFS);
  /** Changements de réglages du matériel, du plus ancien au plus récent. */
  readonly settingChanges = this.live(() => this.db.settingChanges.orderBy('date').toArray(), []);

  /** Dernière photo de chaque habitant (id habitant → id photo). */
  readonly inhabitantCovers = computed(() => {
    const m = new Map<string, string>();
    for (const p of this.photos()) if (p.inhabitantId && !m.has(p.inhabitantId)) m.set(p.inhabitantId, p.id);
    return m;
  });

  readonly speciesById = computed(() => new Map(this.species().map((s) => [s.id, s])));

  /** Catalogue affiché : les fiches intégrées personnalisées sont remplacées par leur copie. */
  readonly catalog = computed(() => {
    const overridden = new Set(this.species().map((s) => s.overrides).filter(Boolean));
    return this.species().filter((s) => !overridden.has(s.id));
  });

  readonly activeTanks = computed(() =>
    this.tanks()
      .filter((t) => !t.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  );

  readonly tankViews = computed<TankView[]>(() => {
    const byId = this.speciesById();
    const inhabitants = this.inhabitants();
    const tests = this.waterTests();
    const tasks = this.tasks();
    const observations = this.observations();
    return this.activeTanks().map((tank) => {
      const members = inhabitants
        .filter((i) => i.tankId === tank.id && isAlive(i) && byId.has(i.speciesId))
        .map((inhabitant) => ({ inhabitant, species: byId.get(inhabitant.speciesId)! }))
        .sort((a, b) => a.species.scientificName.localeCompare(b.species.scientificName));
      const species = members.map((m) => m.species);
      const tankTests = tests.filter((t) => t.tankId === tank.id);
      const lastTest = tankTests.at(-1);
      const alerts = testAlerts(lastTest, species, tank);
      const issues = compatibilityIssues(
        tank,
        members.map((m) => ({ species: m.species, quantity: m.inhabitant.quantity })),
      );
      const lastObservation = observations.filter((o) => o.tankId === tank.id).at(-1);
      const openFindings = (lastObservation?.findings ?? []).filter((f) => !f.resolved && f.severity !== 'info');
      const level = worst([...alerts.map((a) => a.level), ...openFindings.map((f) => (f.severity === 'danger' ? 'danger' : 'warn') as Level)]);
      const first = alerts[0];
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
        tasks: tasks.filter((t) => t.tankId === tank.id && t.active),
        lastObservation,
        openFindings,
      };
    });
  });

  /** Tâches dues aujourd'hui ou en retard, tous bacs confondus. */
  readonly dueTasks = computed<DueTask[]>(() => {
    const today = this.today();
    const tanks = new Map(this.activeTanks().map((t) => [t.id, t]));
    return this.tasks()
      .filter((t) => t.active && t.nextDue <= today && tanks.has(t.tankId))
      .map((task) => ({ task, tank: tanks.get(task.tankId)! }));
  });

  constructor() {
    this.init();
  }

  tankView(id: string): Signal<TankView | undefined> {
    return computed(() => this.tankViews().find((v) => v.tank.id === id));
  }

  private async init(): Promise<void> {
    // Met à jour les fiches du catalogue intégré sans toucher aux fiches personnelles.
    await this.db.species.bulkPut(BUILTIN_SPECIES);
    this.ready.set(true);
  }

  private live<T>(query: () => Promise<T>, initial: T): Signal<T> {
    const s = signal<T>(initial);
    const sub = liveQuery(query).subscribe({ next: (v) => s.set(v), error: (e) => console.error(e) });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
    return s.asReadonly();
  }
}
