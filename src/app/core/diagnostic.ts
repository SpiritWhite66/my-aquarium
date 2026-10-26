// Dossier de diagnostic : tout ce qu'une IA doit savoir sur un bac pour proposer des solutions.
// Lu par le skill « my-aquarium-diagnostic » (ai/diagnostic/SKILL.md).

import type {
  SettingChange,
  Co2Reading,
  Diagnosis,
  Equipment,
  Inhabitant,
  InhabitantEvent,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  ParamKey,
  Photo,
  Species,
  Tank,
  WaterTest,
} from './models';
import { MAIN_PARAMS, PARAM_BY_KEY, compatibilityIssues, idealRange, isAlive, testAlerts } from './rules';
import { co2FromKhPh, gearChecks, latestKhPh, photoperiod, trendOf } from './insights';
import { daysBetween } from './dates';

export interface DossierInput {
  tank: Tank;
  species: Species[];
  inhabitants: Inhabitant[];
  events: InhabitantEvent[];
  tests: WaterTest[];
  tasks: MaintenanceTask[];
  logs: MaintenanceLog[];
  equipment: Equipment[];
  co2Readings: Co2Reading[];
  observations: Observation[];
  diagnoses: Diagnosis[];
  photos: Photo[]; // photos jointes, déjà choisies
  settingChanges?: SettingChange[];
  question?: string;
  today: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Construit le dossier (objet JSON) d'un bac. Seules les données de ce bac sont incluses. */
export function buildDossier(i: DossierInput) {
  const { tank } = i;
  const byId = new Map(i.species.map((s) => [s.id, s]));
  const members = i.inhabitants
    .filter((h) => h.tankId === tank.id && isAlive(h) && byId.has(h.speciesId))
    .map((h) => ({ h, s: byId.get(h.speciesId)! }));
  const species = members.map((m) => m.s);
  const tests = i.tests.filter((t) => t.tankId === tank.id).sort((a, b) => a.date.localeCompare(b.date));
  const gear = i.equipment.filter((e) => e.tankId === tank.id);
  const kp = latestKhPh(tests);

  return {
    format: 'my-aquarium-dossier',
    version: 1,
    generatedAt: new Date().toISOString(),
    question: i.question?.trim() || undefined,
    tank: {
      name: tank.name,
      type: tank.type,
      volumeL: tank.volumeNet ?? tank.volumeGross,
      ageDays: daysBetween(tank.startDate, i.today),
      substrate: tank.substrate,
      co2Injection: tank.co2,
      co2TargetBpm: tank.co2Target,
      cycling: !!tank.cycling,
      notes: tank.notes,
    },
    population: members.map(({ h, s }) => ({
      name: s.commonNames[0],
      scientificName: s.scientificName,
      kind: s.kind,
      quantity: h.quantity,
      approximate: h.approximate || undefined,
      unit: h.unit,
      status: h.status,
      since: h.addedDate,
      ranges: { temp: s.temp, ph: s.ph, gh: s.gh, kh: s.kh },
      flora: s.flora,
      fauna: s.fauna,
    })),
    recentEvents: i.events
      .filter((e) => e.tankId === tank.id)
      .slice(0, 20)
      .map((e) => ({ date: e.date.slice(0, 10), type: e.type, quantityDelta: e.quantityDelta, note: e.note, species: byId.get(i.inhabitants.find((h) => h.id === e.inhabitantId)?.speciesId ?? '')?.scientificName })),
    water: {
      units: Object.fromEntries(MAIN_PARAMS.map((k) => [k, PARAM_BY_KEY[k].unit])),
      idealRanges: Object.fromEntries(
        MAIN_PARAMS.map((k) => {
          const r = idealRange(k, species, tank);
          return [k, r ? { min: r.min, max: r.max, fromSpecies: r.from.length > 0, conflict: r.conflict || undefined } : undefined];
        }),
      ),
      tests: tests.slice(-15).map((t) => ({ date: t.date, values: t.values, method: t.method, note: t.note })),
      outOfRange: testAlerts(tests.at(-1), species, tank).map((a) => ({ param: a.key, value: a.value, level: a.level })),
      trends: Object.fromEntries(
        (MAIN_PARAMS as ParamKey[])
          .map((k) => [k, trendOf(tests, k, idealRange(k, species, tank))] as const)
          .filter(([, t]) => t)
          .map(([k, t]) => [k, { perWeek: t!.perWeek, daysToLimit: t!.daysToLimit, limit: t!.limit }]),
      ),
    },
    co2: tank.co2
      ? {
          estimatedMgL: kp ? co2FromKhPh(kp.kh, kp.ph) : undefined,
          estimatedFrom: kp,
          readings: i.co2Readings.filter((r) => r.tankId === tank.id).slice(-8).map((r) => ({ date: r.date, bpm: r.bubblesPerMinute, dropChecker: r.dropChecker })),
        }
      : undefined,
    equipment: gear.map((e) => ({
      type: e.type,
      name: e.name,
      brand: e.brand,
      model: e.model,
      light: e.light ? { ...e.light, photoperiodHours: photoperiod(e.light) } : undefined,
      filter: e.filter,
      heater: e.heater,
      co2: e.co2,
      specs: e.specs,
      purchaseDate: e.purchaseDate,
    })),
    equipmentChecks: gearChecks(tank, gear).filter((c) => c.level !== 'ok').map((c) => c.title),
    compatibilityIssues: compatibilityIssues(tank, members.map((m) => ({ species: m.s, quantity: m.h.quantity }))).map((x) => `${x.title} : ${x.detail}`),
    maintenance: {
      routine: i.tasks.filter((t) => t.tankId === tank.id && t.active && !t.oneOff).map((t) => ({ label: t.label, type: t.type, everyDays: t.everyDays, nextDue: t.nextDue })),
      recent: i.logs.filter((l) => l.tankId === tank.id).slice(0, 25).map((l) => ({ date: l.date.slice(0, 10), type: l.type, label: l.label, note: l.note, waterChangedL: l.details?.waterChangedLiters })),
    },
    visualChecks: i.observations
      .filter((o) => o.tankId === tank.id)
      .slice(-3)
      .map((o) => ({ date: o.date.slice(0, 10), overall: o.overall, summary: o.summary, findings: o.findings.map((f) => ({ category: f.category, severity: f.severity, title: f.title, resolved: f.resolved || undefined })) })),
    settingsHistory: (i.settingChanges ?? [])
      .filter((c) => c.tankId === tank.id)
      .slice(-15)
      .map((c) => ({ date: c.date.slice(0, 10), equipment: c.equipmentName, setting: c.field, from: c.from, to: c.to, reason: c.note })),
    previousDiagnoses: i.diagnoses
      .filter((d) => d.tankId === tank.id)
      .slice(-3)
      .map((d) => ({
        date: d.date.slice(0, 10),
        question: d.question,
        summary: d.summary,
        mainHypothesis: d.hypotheses[0]?.title,
        actions: d.actions.map((a) => ({ title: a.title, done: !!a.done })),
      })),
    photos: i.photos.map((p, n) => ({ file: photoFileName(p, n), date: p.date.slice(0, 10), caption: p.caption, subject: p.inhabitantId ? 'habitant' : 'bac' })),
    stats: { volumeL: round(tank.volumeNet ?? tank.volumeGross) },
  };
}

export type Dossier = ReturnType<typeof buildDossier>;

export function photoFileName(p: Photo, index: number): string {
  return `photo-${index + 1}-${p.date.slice(0, 10)}.jpg`;
}

/** Texte joint au partage : demande d'analyse pour le skill. */
export function diagnosticRequest(tankName: string, question?: string): string {
  const q = question?.trim();
  return [
    `Diagnostic de mon aquarium « ${tankName} » avec le skill my-aquarium-diagnostic.`,
    q ? `Mon problème : ${q}` : 'Fais un bilan général et dis-moi ce qui peut être amélioré.',
    'Le dossier JSON et les photos sont joints.',
  ].join('\n');
}
