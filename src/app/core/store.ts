import { Injectable, InjectionToken, computed, inject, signal, type Signal } from '@angular/core';
import { liveQuery } from 'dexie';
import { AquariumDb } from './db';
import { BUILTIN_SPECIES } from './catalog';
import { addDays, todayIso } from './dates';
import { processPhoto } from './photos';
import { isZip, readZip, writeZip, type ArchiveEntry } from './archive';
import { BACKUP_TABLES, BACKUP_VERSION, checkBackup } from './backup-format';
import type {
  DoseUnit,
  SettingChange,
  Entity,
  ExportFile,
  Inhabitant,
  InhabitantEvent,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  Photo,
  PhotoFile,
  Co2Reading,
  Diagnosis,
  Consumable,
  Equipment,
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
import { DOSE_UNITS, TASK_TYPES } from './labels';
import { diffSettings } from './settings-history';
import { DEFAULT_PREFS, type NotificationPrefs } from './reminders';

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

/** Base locale ; remplaçable dans les tests. */
export const AQUARIUM_DB = new InjectionToken<AquariumDb>('AQUARIUM_DB', { providedIn: 'root', factory: () => new AquariumDb() });

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

/**
 * Point d'accès unique aux données.
 * V1 : IndexedDB via Dexie. Pour le futur backend, seule cette classe changera :
 * les écrans ne lisent que ses signals et n'appellent que ses méthodes.
 */
@Injectable({ providedIn: 'root' })
export class AquariumStore {
  private readonly db = inject(AQUARIUM_DB);
  private readonly clock: ReturnType<typeof setInterval>;

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
    // La date change à minuit : on la rafraîchit régulièrement.
    this.clock = setInterval(() => this.today.set(todayIso()), 60_000);
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
      [this.db.tanks, this.db.inhabitants, this.db.inhabitantEvents, this.db.waterTests, this.db.tasks, this.db.logs, this.db.observations, this.db.photos, this.db.photoFiles, this.db.co2Readings, this.db.equipment, this.db.diagnoses, this.db.settingChanges],
      async () => {
        await this.db.photoFiles.bulkDelete((await this.db.photos.where('tankId').equals(id).primaryKeys()) as string[]);
        // Le matériel du bac est conservé, en réserve.
        await this.db.equipment.where('tankId').equals(id).modify({ tankId: undefined });
        await this.db.settingChanges.where('tankId').equals(id).delete();
        await this.db.tanks.delete(id);
        for (const table of [this.db.inhabitants, this.db.inhabitantEvents, this.db.waterTests, this.db.tasks, this.db.logs, this.db.observations, this.db.photos, this.db.co2Readings, this.db.diagnoses]) {
          await table.where('tankId').equals(id).delete();
        }
      },
    );
  }

  // ---------- Inventaire ----------

  async addInhabitant(data: New<Inhabitant>): Promise<string> {
    return this.db.transaction('rw', [this.db.inhabitants, this.db.inhabitantEvents], async () => {
      // Même espèce déjà présente et vivante : on cumule la quantité.
      const existing = await this.findAlive(data.tankId, data.speciesId, data.unit);
      const id = existing?.id ?? uuid();
      if (existing) {
        await this.db.inhabitants.update(id, { quantity: existing.quantity + data.quantity, updatedAt: now() });
      } else {
        await this.db.inhabitants.put({ ...data, id, updatedAt: now() } as Inhabitant);
      }
      await this.addEvent({ inhabitantId: id, tankId: data.tankId, date: now(), type: 'added', quantityDelta: data.quantity, note: data.origin });
      return id;
    });
  }

  /** Habitant vivant d'une espèce dans un bac, lu dans la base (pas dans les signals, parfois en retard). */
  private async findAlive(tankId: string, speciesId: string, unit: Inhabitant['unit']): Promise<Inhabitant | undefined> {
    const list = await this.db.inhabitants.where('tankId').equals(tankId).toArray();
    return list.find((i) => i.speciesId === speciesId && isAlive(i) && i.unit === unit);
  }

  async updateInhabitant(id: string, changes: Partial<Inhabitant>): Promise<void> {
    await this.db.inhabitants.update(id, { ...changes, updatedAt: now() });
  }

  async addEvent(e: New<InhabitantEvent>): Promise<void> {
    await this.db.inhabitantEvents.put({ ...e, id: e.id ?? uuid(), updatedAt: now() } as InhabitantEvent);
  }

  /** Enregistre un événement et ajuste la quantité (naissance, décès, bouture…). */
  async recordEvent(inhabitant: Inhabitant, type: InhabitantEvent['type'], quantityDelta = 0, note?: string): Promise<void> {
    await this.db.transaction('rw', [this.db.inhabitants, this.db.inhabitantEvents], async () => {
      await this.addEvent({ inhabitantId: inhabitant.id, tankId: inhabitant.tankId, date: now(), type, quantityDelta: quantityDelta || undefined, note });
      if (!quantityDelta) return;
      const current = (await this.db.inhabitants.get(inhabitant.id)) ?? inhabitant;
      const quantity = Math.max(0, current.quantity + quantityDelta);
      await this.updateInhabitant(inhabitant.id, { quantity, status: quantity === 0 && type === 'death' ? 'dead' : current.status });
    });
  }

  async deleteInhabitant(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.inhabitants, this.db.photos, this.db.photoFiles, this.db.inhabitantEvents], async () => {
      await this.db.photoFiles.bulkDelete((await this.db.photos.where('inhabitantId').equals(id).primaryKeys()) as string[]);
      await this.db.inhabitants.delete(id);
      await this.db.photos.where('inhabitantId').equals(id).delete();
      await this.db.inhabitantEvents.where('inhabitantId').equals(id).delete();
    });
  }

  // ---------- Eau ----------

  async addWaterTest(test: New<WaterTest>): Promise<void> {
    const today = this.today();
    await this.db.transaction('rw', [this.db.waterTests, this.db.tasks, this.db.logs, this.db.diagnoses], async () => {
      await this.db.waterTests.put({ ...test, id: test.id ?? uuid(), updatedAt: now() } as WaterTest);
      // Un relevé valide la tâche « Test de l'eau » du bac si elle est due.
      const tasks = await this.db.tasks.where('tankId').equals(test.tankId).toArray();
      const due = tasks.find((t) => t.type === 'water_test' && t.active && t.nextDue <= today);
      if (due) await this.completeTask(due, 'Relevé ajouté');
    });
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

  async completeTask(task: MaintenanceTask, note?: string, details?: MaintenanceLog['details']): Promise<void> {
    await this.completeTaskWith(task, [{ label: task.label, note, details }]);
  }

  /** Doses d'engrais (une ligne par produit), en validant la tâche si elle est fournie. */
  async logDoses(tankId: string, doses: { product: string; amount?: number; unit?: DoseUnit; consumableId?: string }[], task?: MaintenanceTask, note?: string): Promise<void> {
    const entries = doses.map((d) => ({
      label: `Engrais — ${d.product}${d.amount != null ? ` ${String(d.amount).replace('.', ',')} ${DOSE_UNITS[d.unit ?? 'ml']}` : ''}`,
      note,
      details: { product: d.product, amount: d.amount, unit: d.unit, consumableId: d.consumableId },
    }));
    if (task) return this.completeTaskWith(task, entries, 'fertilize');
    await this.db.logs.bulkPut(entries.map((e) => ({ ...e, id: uuid(), updatedAt: now(), tankId, type: 'fertilize' as const, date: now() })));
  }

  private async completeTaskWith(task: MaintenanceTask, entries: Pick<MaintenanceLog, 'label' | 'note' | 'details'>[], type = task.type): Promise<void> {
    const today = this.today();
    await this.db.transaction('rw', [this.db.tasks, this.db.logs, this.db.diagnoses], async () => {
      await this.db.logs.bulkPut(entries.map((e) => ({ ...e, id: uuid(), updatedAt: now(), tankId: task.tankId, taskId: task.id, type, date: now() })));
      await this.db.tasks.update(task.id, task.oneOff ? { active: false, updatedAt: now() } : { nextDue: addDays(today, task.everyDays), updatedAt: now() });
      // Tâche issue d'un diagnostic : l'action correspondante est marquée faite.
      const diag = task.diagnosisId && task.oneOff ? await this.db.diagnoses.get(task.diagnosisId) : undefined;
      if (diag) {
        const actions = diag.actions.map((a) => (a.taskId === task.id ? { ...a, done: true } : a));
        await this.db.diagnoses.update(diag.id, { actions, updatedAt: now() });
      }
    });
  }

  /** Mode vacances : les tâches dues avant le retour sont décalées au jour du retour. */
  async postponeTasks(until: string): Promise<number> {
    const late = this.tasks().filter((t) => t.active && t.nextDue < until);
    await this.db.tasks.bulkUpdate(late.map((t) => ({ key: t.id, changes: { nextDue: until, updatedAt: now() } })));
    return late.length;
  }

  async addLog(log: New<MaintenanceLog>): Promise<void> {
    await this.db.logs.put({ ...log, id: log.id ?? uuid(), updatedAt: now() } as MaintenanceLog);
  }

  // ---------- Photos ----------

  /** Réduit puis enregistre une ou plusieurs photos. Renvoie les identifiants créés. */
  async addPhotos(files: File[], target: { tankId: string; inhabitantId?: string }, caption?: string): Promise<string[]> {
    // Réduction des images d'abord : une transaction IndexedDB ne survit pas à un traitement asynchrone externe.
    const processed: Photo[] = [];
    const images: PhotoFile[] = [];
    for (const file of files) {
      const p = await processPhoto(file);
      // La date de la photo est celle du fichier quand elle est fiable, sinon maintenant.
      const taken = file.lastModified && file.lastModified < Date.now() ? new Date(file.lastModified) : new Date();
      const id = uuid();
      processed.push({ id, updatedAt: now(), ...target, date: taken.toISOString(), caption: caption || undefined, width: p.width, height: p.height });
      images.push({ id, full: p.full, thumb: p.thumb });
    }
    await this.db.transaction('rw', [this.db.photos, this.db.photoFiles, this.db.tanks], async () => {
      await this.db.photoFiles.bulkPut(images);
      await this.db.photos.bulkPut(processed);
      // Première photo d'un bac : elle devient sa photo de couverture.
      const tank = await this.db.tanks.get(target.tankId);
      if (tank && !tank.coverPhotoId && !target.inhabitantId && processed.length) {
        await this.db.tanks.update(tank.id, { coverPhotoId: processed[0].id, updatedAt: now() });
      }
    });
    return processed.map((p) => p.id);
  }

  /** Images d'une photo, lues à la demande. */
  photoFile(id: string): Promise<PhotoFile | undefined> {
    return this.db.photoFiles.get(id);
  }

  async setCaption(id: string, caption: string): Promise<void> {
    await this.db.photos.update(id, { caption: caption.trim() || undefined, updatedAt: now() });
  }

  async setCover(tankId: string, photoId: string | undefined): Promise<void> {
    await this.db.tanks.update(tankId, { coverPhotoId: photoId, updatedAt: now() });
  }

  async deletePhoto(photo: Photo): Promise<void> {
    await this.db.transaction('rw', [this.db.photos, this.db.photoFiles, this.db.tanks], async () => {
      await this.db.photos.delete(photo.id);
      await this.db.photoFiles.delete(photo.id);
      const tank = await this.db.tanks.get(photo.tankId);
      if (tank?.coverPhotoId !== photo.id) return;
      // La couverture passe à la photo de bac la plus récente restante.
      const rest = await this.db.photos.where('tankId').equals(tank.id).filter((p) => !p.inhabitantId).sortBy('date');
      await this.db.tanks.update(tank.id, { coverPhotoId: rest.at(-1)?.id, updatedAt: now() });
    });
  }

  // ---------- Diagnostics ----------

  /** Enregistre un diagnostic ; les actions cochées deviennent des tâches. */
  async addDiagnosis(d: New<Diagnosis>, createTasks: boolean[]): Promise<string> {
    const id = d.id ?? uuid();
    const today = this.today();
    const tasks: MaintenanceTask[] = [];
    const actions = d.actions.map((a, i) => {
      if (!a.task || !createTasks[i]) return a;
      const taskId = uuid();
      tasks.push({
        id: taskId, updatedAt: now(), tankId: d.tankId, type: a.task.type, label: a.task.label,
        everyDays: a.task.everyDays ?? 7, nextDue: addDays(today, a.task.inDays ?? 0), active: true,
        oneOff: !a.task.everyDays, diagnosisId: id,
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

  // ---------- Matériel, consommables, CO2 ----------

  /**
   * Enregistre un équipement. Si des réglages suivis changent (intensité, horaires…),
   * le changement est historisé à la date `effective` (aujourd'hui par défaut).
   */
  async saveEquipment(e: New<Equipment>, change?: { effective?: string; note?: string }): Promise<string> {
    const id = e.id ?? uuid();
    await this.db.transaction('rw', [this.db.equipment, this.db.settingChanges], async () => {
      const before = e.id ? await this.db.equipment.get(e.id) : undefined;
      await this.db.equipment.put({ ...e, id, updatedAt: now() } as Equipment);
      if (!before) return;
      const date = change?.effective && change.effective !== this.today() ? new Date(`${change.effective}T12:00`).toISOString() : now();
      const note = change?.note?.trim() || undefined;
      await this.db.settingChanges.bulkPut(
        diffSettings(before, e).map((d) => ({ ...d, id: uuid(), updatedAt: now(), date, note, tankId: e.tankId, equipmentId: id, equipmentName: e.name })),
      );
    });
    return id;
  }
  async deleteEquipment(id: string): Promise<void> {
    await this.db.equipment.delete(id);
  }
  async saveNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<void> {
    await this.db.transaction('rw', this.db.prefs, async () => {
      const cur = (await this.db.prefs.get('notifications')) ?? DEFAULT_PREFS;
      await this.db.prefs.put({ ...cur, ...patch, id: 'notifications' });
    });
  }
  async updateSettingChange(id: string, patch: Partial<Pick<SettingChange, 'date' | 'note'>>): Promise<void> {
    await this.db.settingChanges.update(id, { ...patch, updatedAt: now() });
  }
  async deleteSettingChange(id: string): Promise<void> {
    await this.db.settingChanges.delete(id);
  }
  async saveConsumable(c: New<Consumable>): Promise<string> {
    const id = c.id ?? uuid();
    await this.db.consumables.put({ ...c, id, updatedAt: now() } as Consumable);
    return id;
  }
  async setConsumableLevel(id: string, level: Consumable['level']): Promise<void> {
    await this.db.consumables.update(id, { level, updatedAt: now() });
  }
  async deleteConsumable(id: string): Promise<void> {
    await this.db.consumables.delete(id);
  }
  async addCo2Reading(r: New<Co2Reading>): Promise<void> {
    await this.db.co2Readings.put({ ...r, id: r.id ?? uuid(), updatedAt: now() } as Co2Reading);
  }
  async deleteCo2Reading(id: string): Promise<void> {
    await this.db.co2Readings.delete(id);
  }

  // ---------- Déplacement, corrections ----------

  /** Déplace tout ou partie d'un habitant vers un autre bac (quarantaine → bac principal…). */
  async moveInhabitant(inh: Inhabitant, toTankId: string, quantity = inh.quantity): Promise<void> {
    if (toTankId === inh.tankId || quantity < 1) return;
    const from = this.tanks().find((t) => t.id === inh.tankId)?.name ?? 'bac';
    const to = this.tanks().find((t) => t.id === toTankId)?.name ?? 'bac';
    await this.db.transaction('rw', [this.db.inhabitants, this.db.inhabitantEvents, this.db.photos], async () => {
      const current = await this.db.inhabitants.get(inh.id);
      if (!current) return;
      if (quantity >= current.quantity) {
        await this.db.inhabitants.update(inh.id, { tankId: toTankId, updatedAt: now() });
        // L'historique et les photos suivent l'habitant.
        await this.db.inhabitantEvents.where('inhabitantId').equals(inh.id).modify({ tankId: toTankId });
        await this.db.photos.where('inhabitantId').equals(inh.id).modify({ tankId: toTankId });
        await this.addEvent({ inhabitantId: inh.id, tankId: toTankId, date: now(), type: 'moved', note: `${from} → ${to}` });
        return;
      }
      await this.updateInhabitant(inh.id, { quantity: current.quantity - quantity });
      await this.addEvent({ inhabitantId: inh.id, tankId: current.tankId, date: now(), type: 'moved', quantityDelta: -quantity, note: `${quantity} vers ${to}` });
      const target = await this.findAlive(toTankId, current.speciesId, current.unit);
      if (target) {
        await this.updateInhabitant(target.id, { quantity: target.quantity + quantity });
        await this.addEvent({ inhabitantId: target.id, tankId: toTankId, date: now(), type: 'moved', quantityDelta: quantity, note: `depuis ${from}` });
      } else {
        const id = uuid();
        await this.db.inhabitants.put({ ...current, id, tankId: toTankId, quantity, addedDate: this.today(), origin: `Déplacé depuis ${from}`, updatedAt: now() });
        await this.addEvent({ inhabitantId: id, tankId: toTankId, date: now(), type: 'moved', quantityDelta: quantity, note: `depuis ${from}` });
      }
    });
  }

  async updateWaterTest(test: WaterTest): Promise<void> {
    await this.db.waterTests.put({ ...test, updatedAt: now() });
  }

  // ---------- Catalogue personnel ----------

  /** Fait pointer les habitants d'une fiche vers une autre (personnalisation d'une fiche intégrée). */
  async replaceSpecies(oldId: string, newId: string): Promise<void> {
    await this.db.inhabitants.where('speciesId').equals(oldId).modify({ speciesId: newId, updatedAt: now() });
  }

  /** Supprime une fiche personnelle ; les habitants d'une fiche personnalisée retrouvent la fiche intégrée. */
  async deleteSpecies(id: string): Promise<void> {
    const s = this.speciesById().get(id);
    if (!s || s.source !== 'custom') return;
    await this.db.transaction('rw', [this.db.inhabitants, this.db.species], async () => {
      if (s.overrides) await this.replaceSpecies(id, s.overrides);
      await this.db.species.delete(id);
    });
  }

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

  /**
   * Sauvegarde complète en ZIP : data.json (toutes les tables sauf les préférences de l'appareil)
   * et les images dans photos/. Les images sont lues une par une.
   */
  async exportArchive(): Promise<{ blob: Blob; exportedAt: string }> {
    const exportedAt = now();
    const data: Record<string, unknown> = {};
    for (const table of BACKUP_TABLES) {
      data[table] = table === 'species' ? await this.db.species.where('source').equals('custom').toArray() : await this.db.table(table).toArray();
    }
    const file: ExportFile = { format: 'my-aquarium', version: BACKUP_VERSION, exportedAt, data: data as ExportFile['data'] };
    const ids = (await this.db.photos.toCollection().primaryKeys()) as string[];
    const db = this.db;
    async function* entries(): AsyncGenerator<ArchiveEntry> {
      yield { name: 'data.json', data: new Blob([JSON.stringify(file)], { type: 'application/json' }) };
      for (const id of ids) {
        const img = await db.photoFiles.get(id);
        if (!img) continue;
        yield { name: `photos/${id}-full.jpg`, data: img.full };
        yield { name: `photos/${id}-thumb.jpg`, data: img.thumb };
      }
    }
    return { blob: await writeZip(entries()), exportedAt };
  }

  /**
   * Remplace toutes les données par celles d'une sauvegarde (ZIP, ou ancien JSON).
   * Le fichier est entièrement vérifié avant d'effacer quoi que ce soit.
   * Renvoie les remarques sans gravité (lignes écartées…).
   */
  async importBackup(file: Blob): Promise<string[]> {
    let raw: unknown;
    let images: Map<string, Blob> | undefined;
    try {
      if (await isZip(file)) {
        images = await readZip(file);
        const json = images.get('data.json');
        if (!json) throw new Error('data.json absent');
        raw = JSON.parse(await json.text());
      } else raw = JSON.parse(await file.text());
    } catch {
      throw new Error('Fichier illisible : ce n’est pas une sauvegarde Mes aquariums.');
    }
    const { data, files, warnings } = checkBackup(raw, images);
    const d = data as unknown as Record<string, Entity[]>;
    const tables = [...BACKUP_TABLES.map((t) => this.db.table(t)), this.db.photoFiles];
    await this.db.transaction('rw', tables, async () => {
      for (const table of BACKUP_TABLES) {
        if (table === 'species') await this.db.species.where('source').equals('custom').delete();
        else await this.db.table(table).clear();
      }
      await this.db.photoFiles.clear();
      for (const table of BACKUP_TABLES) {
        const rows = table === 'species' ? d[table].map((s) => ({ ...s, source: 'custom' })) : d[table];
        await this.db.table(table).bulkPut(rows);
      }
      await this.db.photoFiles.bulkPut([...files].map(([id, f]) => ({ id, ...f })));
    });
    return warnings;
  }

  // ---------- Interne ----------

  private async init(): Promise<void> {
    // Met à jour les fiches du catalogue intégré sans toucher aux fiches personnelles.
    await this.db.species.bulkPut(BUILTIN_SPECIES);
    this.ready.set(true);
  }

  /** Pour les tests : arrête l'horloge et ferme la base. */
  destroy(): void {
    clearInterval(this.clock);
    this.db.close();
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
