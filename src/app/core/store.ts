import { Injectable, computed, signal, type Signal } from '@angular/core';
import { liveQuery } from 'dexie';
import { AquariumDb } from './db';
import { BUILTIN_SPECIES } from './catalog';
import { addDays, todayIso } from './dates';
import { blobToDataUrl, dataUrlToBlob, processPhoto } from './photos';
import type {
  Entity,
  ExportFile,
  Inhabitant,
  InhabitantEvent,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  Photo,
  Species,
  Tank,
  TaskType,
  WaterTest,
} from './models';
import {
  compatibilityIssues,
  isAlive,
  testAlerts,
  worst,
  type Issue,
  type Level,
  type ParamAlert,
} from './rules';
import { PARAM_BY_KEY } from './rules';
import { TASK_TYPES } from './labels';

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

type New<T extends Entity> = Omit<T, 'id' | 'updatedAt'> & Partial<Pick<T, 'id'>>;

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

/**
 * Point d'accès unique aux données.
 * V1 : IndexedDB via Dexie. Pour le futur backend, seule cette classe changera :
 * les écrans ne lisent que ses signals et n'appellent que ses méthodes.
 */
@Injectable({ providedIn: 'root' })
export class AquariumStore {
  private readonly db = new AquariumDb();

  readonly ready = signal(false);
  readonly today = signal(todayIso());

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

  /** Dernière photo de chaque habitant (id habitant → id photo). */
  readonly inhabitantCovers = computed(() => {
    const m = new Map<string, string>();
    for (const p of this.photos()) if (p.inhabitantId && !m.has(p.inhabitantId)) m.set(p.inhabitantId, p.id);
    return m;
  });

  readonly speciesById = computed(() => new Map(this.species().map((s) => [s.id, s])));

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
    // La date change à minuit : on la rafraîchit régulièrement.
    setInterval(() => this.today.set(todayIso()), 60_000);
  }

  tankView(id: string): Signal<TankView | undefined> {
    return computed(() => this.tankViews().find((v) => v.tank.id === id));
  }

  // ---------- Bacs ----------

  async saveTank(tank: New<Tank>, withDefaultTasks = false): Promise<string> {
    const id = tank.id ?? uuid();
    await this.db.tanks.put({ ...tank, id, updatedAt: now() } as Tank);
    if (withDefaultTasks) await this.db.tasks.bulkPut(defaultTasks(id, tank.type, tank.co2, this.today()));
    return id;
  }

  async archiveTank(id: string, archived = true): Promise<void> {
    await this.db.tanks.update(id, { archived, updatedAt: now() });
  }

  async deleteTank(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.tanks, this.db.inhabitants, this.db.inhabitantEvents, this.db.waterTests, this.db.tasks, this.db.logs, this.db.observations, this.db.photos],
      async () => {
        await this.db.tanks.delete(id);
        for (const table of [this.db.inhabitants, this.db.inhabitantEvents, this.db.waterTests, this.db.tasks, this.db.logs, this.db.observations, this.db.photos]) {
          await table.where('tankId').equals(id).delete();
        }
      },
    );
  }

  // ---------- Inventaire ----------

  async addInhabitant(data: New<Inhabitant>): Promise<string> {
    // Même espèce déjà présente et vivante : on cumule la quantité.
    const existing = this.inhabitants().find(
      (i) => i.tankId === data.tankId && i.speciesId === data.speciesId && isAlive(i) && i.unit === data.unit,
    );
    const id = existing?.id ?? uuid();
    if (existing) {
      await this.db.inhabitants.update(id, { quantity: existing.quantity + data.quantity, updatedAt: now() });
    } else {
      await this.db.inhabitants.put({ ...data, id, updatedAt: now() } as Inhabitant);
    }
    await this.addEvent({ inhabitantId: id, tankId: data.tankId, date: now(), type: 'added', quantityDelta: data.quantity, note: data.origin });
    return id;
  }

  async updateInhabitant(id: string, changes: Partial<Inhabitant>): Promise<void> {
    await this.db.inhabitants.update(id, { ...changes, updatedAt: now() });
  }

  async addEvent(e: New<InhabitantEvent>): Promise<void> {
    await this.db.inhabitantEvents.put({ ...e, id: e.id ?? uuid(), updatedAt: now() } as InhabitantEvent);
  }

  /** Enregistre un événement et ajuste la quantité (naissance, décès, bouture…). */
  async recordEvent(inhabitant: Inhabitant, type: InhabitantEvent['type'], quantityDelta = 0, note?: string): Promise<void> {
    await this.addEvent({ inhabitantId: inhabitant.id, tankId: inhabitant.tankId, date: now(), type, quantityDelta: quantityDelta || undefined, note });
    if (quantityDelta) {
      const quantity = Math.max(0, inhabitant.quantity + quantityDelta);
      await this.updateInhabitant(inhabitant.id, { quantity, status: quantity === 0 && type === 'death' ? 'dead' : inhabitant.status });
    }
  }

  async deleteInhabitant(id: string): Promise<void> {
    await this.db.inhabitants.delete(id);
    await this.db.photos.where('inhabitantId').equals(id).delete();
    await this.db.inhabitantEvents.where('inhabitantId').equals(id).delete();
  }

  // ---------- Eau ----------

  async addWaterTest(test: New<WaterTest>): Promise<void> {
    await this.db.waterTests.put({ ...test, id: test.id ?? uuid(), updatedAt: now() } as WaterTest);
    // Un relevé valide la tâche « Test de l'eau » du bac si elle est due.
    const due = this.tasks().find((t) => t.tankId === test.tankId && t.type === 'water_test' && t.active && t.nextDue <= this.today());
    if (due) await this.completeTask(due, 'Relevé ajouté');
  }

  async deleteWaterTest(id: string): Promise<void> {
    await this.db.waterTests.delete(id);
  }

  // ---------- Entretien ----------

  async saveTask(task: New<MaintenanceTask>): Promise<void> {
    await this.db.tasks.put({ ...task, id: task.id ?? uuid(), updatedAt: now() } as MaintenanceTask);
  }

  async deleteTask(id: string): Promise<void> {
    await this.db.tasks.delete(id);
  }

  async completeTask(task: MaintenanceTask, note?: string): Promise<void> {
    const today = this.today();
    await this.db.transaction('rw', [this.db.tasks, this.db.logs], async () => {
      await this.db.logs.put({ id: uuid(), updatedAt: now(), tankId: task.tankId, taskId: task.id, type: task.type, label: task.label, date: now(), note });
      await this.db.tasks.update(task.id, { nextDue: addDays(today, task.everyDays), updatedAt: now() });
    });
  }

  async addLog(log: New<MaintenanceLog>): Promise<void> {
    await this.db.logs.put({ ...log, id: log.id ?? uuid(), updatedAt: now() } as MaintenanceLog);
  }

  // ---------- Photos ----------

  /** Réduit puis enregistre une ou plusieurs photos. Renvoie les identifiants créés. */
  async addPhotos(files: File[], target: { tankId: string; inhabitantId?: string }, caption?: string): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) {
      const p = await processPhoto(file);
      // La date de la photo est celle du fichier quand elle est fiable, sinon maintenant.
      const taken = file.lastModified && file.lastModified < Date.now() ? new Date(file.lastModified) : new Date();
      const id = uuid();
      await this.db.photos.put({
        id, updatedAt: now(), ...target, date: taken.toISOString(), caption: caption || undefined,
        full: p.full, thumb: p.thumb, width: p.width, height: p.height,
      });
      ids.push(id);
    }
    // Première photo d'un bac : elle devient sa photo de couverture.
    const tank = this.tanks().find((t) => t.id === target.tankId);
    if (tank && !tank.coverPhotoId && !target.inhabitantId && ids.length) {
      await this.db.tanks.update(tank.id, { coverPhotoId: ids[0], updatedAt: now() });
    }
    return ids;
  }

  async setCaption(id: string, caption: string): Promise<void> {
    await this.db.photos.update(id, { caption: caption.trim() || undefined, updatedAt: now() });
  }

  async setCover(tankId: string, photoId: string | undefined): Promise<void> {
    await this.db.tanks.update(tankId, { coverPhotoId: photoId, updatedAt: now() });
  }

  async deletePhoto(photo: Photo): Promise<void> {
    await this.db.photos.delete(photo.id);
    const tank = this.tanks().find((t) => t.id === photo.tankId);
    if (tank?.coverPhotoId === photo.id) {
      // La couverture passe à la photo de bac la plus récente restante.
      const next = this.photos().find((p) => p.tankId === tank.id && p.id !== photo.id && !p.inhabitantId);
      await this.db.tanks.update(tank.id, { coverPhotoId: next?.id, updatedAt: now() });
    }
  }

  // ---------- Catalogue personnel ----------

  async saveSpecies(species: New<Species>): Promise<string> {
    const id = species.id ?? `custom-${uuid()}`;
    await this.db.species.put({ ...species, id, source: 'custom', updatedAt: now() } as Species);
    return id;
  }

  // ---------- Bilans visuels ----------

  async addObservation(o: New<Observation>): Promise<void> {
    await this.db.observations.put({ ...o, id: o.id ?? uuid(), updatedAt: now() } as Observation);
  }

  async setFindingResolved(o: Observation, index: number, resolved: boolean): Promise<void> {
    const findings = o.findings.map((f, i) => (i === index ? { ...f, resolved } : f));
    await this.db.observations.update(o.id, { findings, updatedAt: now() });
  }

  async deleteObservation(id: string): Promise<void> {
    await this.db.observations.delete(id);
  }

  // ---------- Export / import ----------

  async exportData(): Promise<ExportFile> {
    return {
      format: 'my-aquarium',
      version: 1,
      exportedAt: now(),
      data: {
        tanks: await this.db.tanks.toArray(),
        species: await this.db.species.where('source').equals('custom').toArray(),
        inhabitants: await this.db.inhabitants.toArray(),
        inhabitantEvents: await this.db.inhabitantEvents.toArray(),
        waterTests: await this.db.waterTests.toArray(),
        tasks: await this.db.tasks.toArray(),
        logs: await this.db.logs.toArray(),
        observations: await this.db.observations.toArray(),
        photos: await Promise.all(
          (await this.db.photos.toArray()).map(async (p) => ({ ...p, full: await blobToDataUrl(p.full), thumb: await blobToDataUrl(p.thumb) })),
        ),
      },
    };
  }

  /** Remplace toutes les données par celles du fichier. */
  async importData(file: unknown): Promise<void> {
    const f = file as ExportFile;
    if (f?.format !== 'my-aquarium' || f.version !== 1 || !f.data) {
      throw new Error('Ce fichier n’est pas une sauvegarde My Aquarium valide.');
    }
    const d = f.data;
    const tables = [this.db.tanks, this.db.species, this.db.inhabitants, this.db.inhabitantEvents, this.db.waterTests, this.db.tasks, this.db.logs, this.db.observations, this.db.photos];
    await this.db.transaction('rw', tables, async () => {
      for (const t of tables) if (t !== this.db.species) await t.clear();
      await this.db.species.where('source').equals('custom').delete();
      await this.db.tanks.bulkPut(d.tanks ?? []);
      await this.db.species.bulkPut((d.species ?? []).map((s) => ({ ...s, source: 'custom' as const })));
      await this.db.inhabitants.bulkPut(d.inhabitants ?? []);
      await this.db.inhabitantEvents.bulkPut(d.inhabitantEvents ?? []);
      await this.db.waterTests.bulkPut(d.waterTests ?? []);
      await this.db.tasks.bulkPut(d.tasks ?? []);
      await this.db.logs.bulkPut(d.logs ?? []);
      await this.db.observations.bulkPut(d.observations ?? []);
      await this.db.photos.bulkPut((d.photos ?? []).map((p) => ({ ...p, full: dataUrlToBlob(p.full), thumb: dataUrlToBlob(p.thumb) })));
    });
  }

  // ---------- Interne ----------

  private async init(): Promise<void> {
    // Met à jour les fiches du catalogue intégré sans toucher aux fiches personnelles.
    await this.db.species.bulkPut(BUILTIN_SPECIES);
    this.ready.set(true);
  }

  private live<T>(query: () => Promise<T>, initial: T): Signal<T> {
    const s = signal<T>(initial);
    liveQuery(query).subscribe({ next: (v) => s.set(v), error: (e) => console.error(e) });
    return s.asReadonly();
  }
}

/** Tâches proposées à la création d'un bac. */
export function defaultTasks(tankId: string, type: Tank['type'], co2: boolean, today: string): MaintenanceTask[] {
  const t = (type: TaskType, everyDays: number, label = TASK_TYPES[type]): MaintenanceTask => ({
    id: uuid(),
    updatedAt: now(),
    tankId,
    type,
    label,
    everyDays,
    nextDue: addDays(today, everyDays),
    active: true,
  });
  const list = [t('water_change', 7, 'Changement d’eau 30 %'), t('water_test', 7), t('glass_clean', 7), t('filter_clean', 30)];
  if (type === 'planted' || type === 'community') {
    list.push(t('fertilize', 7), t('plant_trim', 21));
  }
  if (co2) list.push(t('co2_refill', 60));
  return list;
}
