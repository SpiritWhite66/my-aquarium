// Dossier de diagnostic : tout ce qu'une IA doit savoir sur un bac pour proposer des solutions.
// Lu par le skill « my-aquarium-diagnostic » (ai/diagnostic/SKILL.md).

import type {
  Consumable,
  SettingChange,
  Co2Reading,
  Diagnosis,
  Equipment,
  Inhabitant,
  InhabitantEvent,
  MaintenanceLog,
  MaintenanceTask,
  Observation,
  Photo,
  Species,
  Tank,
  WaterTest,
} from './models';
import {
  PARAM_BY_KEY,
  measuredParams,
  compatibilityIssues,
  idealRange,
  isAlive,
  testAlerts,
} from './rules';
import {
  co2FromKhPh,
  co2FromPhDrop,
  gearChecks,
  latestKhPh,
  photoperiod,
  trendOf,
} from './insights';
import { addDays, daysBetween, localDay } from './dates';
import { sinceDiagnosis } from './follow-up';
import { must } from './assert';

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
  allPhotos?: Photo[]; // toutes les photos du bac (pour compter celles prises depuis le diagnostic)
  settingChanges?: SettingChange[];
  consumables?: Consumable[];
  /** Diagnostic dont celui-ci est le suivi : le dossier résume ce qui a changé depuis. */
  followUpOf?: Diagnosis;
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
    .map((h) => ({ h, s: must(byId.get(h.speciesId)) }));
  const species = members.map((m) => m.s);
  const tests = i.tests
    .filter((t) => t.tankId === tank.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const params = measuredParams(tests);
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
      .map((e) => ({
        date: localDay(e.date),
        type: e.type,
        quantityDelta: e.quantityDelta,
        note: e.note,
        species: byId.get(i.inhabitants.find((h) => h.id === e.inhabitantId)?.speciesId ?? '')
          ?.scientificName,
      })),
    water: {
      measured: params,
      units: Object.fromEntries(params.map((k) => [k, PARAM_BY_KEY[k].unit])),
      idealRanges: Object.fromEntries(
        params.map((k) => {
          const r = idealRange(k, species, tank);
          return [
            k,
            r
              ? {
                  min: r.min,
                  max: r.max,
                  fromSpecies: r.from.length > 0,
                  conflict: r.conflict || undefined,
                }
              : undefined,
          ];
        }),
      ),
      tests: tests
        .slice(-15)
        .map((t) => ({ date: t.date, values: t.values, method: t.method, note: t.note })),
      outOfRange: testAlerts(tests.at(-1), species, tank).map((a) => ({
        param: a.key,
        value: a.value,
        level: a.level,
      })),
      trends: Object.fromEntries(
        params
          .map((k) => [k, trendOf(tests, k, idealRange(k, species, tank))] as const)
          .filter(([, t]) => t)
          .map(([k, t]) => [
            k,
            { perWeek: must(t).perWeek, daysToLimit: must(t).daysToLimit, limit: must(t).limit },
          ]),
      ),
    },
    co2: tank.co2
      ? {
          estimatedMgL: kp ? co2FromKhPh(kp.kh, kp.ph) : undefined,
          estimatedFrom: kp,
          readings: i.co2Readings
            .filter((r) => r.tankId === tank.id)
            .slice(-8)
            .map((r) => ({ date: r.date, bpm: r.bubblesPerMinute, dropChecker: r.dropChecker }))
            .filter((r) => r.bpm != null || r.dropChecker),
          phDrop: i.co2Readings
            .filter((r) => r.tankId === tank.id && r.phBefore != null && r.phAfter != null)
            .slice(-5)
            .map((r) => ({
              date: localDay(r.date),
              phBefore: r.phBefore,
              phBeforeTime: r.phBeforeTime,
              phAfter: r.phAfter,
              phAfterTime: r.phAfterTime,
              ...co2FromPhDrop(must(r.phBefore), must(r.phAfter)),
            })),
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
    equipmentChecks: gearChecks(tank, gear)
      .filter((c) => c.level !== 'ok')
      .map((c) => c.title),
    compatibilityIssues: compatibilityIssues(
      tank,
      members.map((m) => ({ species: m.s, quantity: m.h.quantity })),
    ).map((x) => `${x.title} : ${x.detail}`),
    maintenance: {
      routine: i.tasks
        .filter((t) => t.tankId === tank.id && t.active && !t.oneOff)
        .map((t) => ({ label: t.label, type: t.type, everyDays: t.everyDays, nextDue: t.nextDue })),
      recent: i.logs
        .filter((l) => l.tankId === tank.id)
        .slice(0, 25)
        .map((l) => ({
          date: localDay(l.date),
          type: l.type,
          label: l.label,
          note: l.note,
          waterChangedL: l.details?.waterChangedLiters,
        })),
    },
    visualChecks: i.observations
      .filter((o) => o.tankId === tank.id)
      .slice(-8)
      .map((o) => ({
        date: localDay(o.date),
        manual: o.manual || undefined,
        algaeLevel: o.algaeLevel,
        algaeTypes: o.algaeTypes,
        overall: o.overall,
        summary: o.summary,
        findings: o.findings.map((f) => ({
          category: f.category,
          severity: f.severity,
          title: f.title,
          resolved: f.resolved || undefined,
        })),
      })),
    fertilization: {
      productsInStock: (i.consumables ?? [])
        .filter((c) => c.category === 'fertilizer')
        .map((c) => ({ name: c.name, brand: c.brand, level: c.level })),
      doses: i.logs
        .filter(
          (l) =>
            l.tankId === tank.id &&
            l.type === 'fertilize' &&
            daysBetween(localDay(l.date), i.today) <= 30,
        )
        .map((l) => ({
          date: localDay(l.date),
          product: l.details?.product ?? l.label,
          amount: l.details?.amount,
          unit: l.details?.unit,
        })),
    },
    settingsHistory: (i.settingChanges ?? [])
      .filter((c) => c.tankId === tank.id)
      .slice(-15)
      .map((c) => ({
        date: localDay(c.date),
        equipment: c.equipmentName,
        setting: c.field,
        from: c.from,
        to: c.to,
        reason: c.note,
      })),
    sinceLastDiagnosis: i.followUpOf
      ? sinceDiagnosis(
          i.followUpOf,
          {
            tests,
            co2Readings: i.co2Readings,
            photos: i.allPhotos ?? i.photos,
            logs: i.logs,
            settingChanges: i.settingChanges ?? [],
            observations: i.observations,
          },
          i.today,
        )
      : undefined,
    previousDiagnoses: i.diagnoses
      .filter((d) => d.tankId === tank.id)
      .slice(-3)
      .map((d) => ({
        date: localDay(d.date),
        question: d.question,
        summary: d.summary,
        mainHypothesis: d.hypotheses[0]?.title,
        actions: d.actions.map((a) => ({ title: a.title, done: !!a.done })),
      })),
    photos: i.photos.map((p, n) => ({
      file: photoFileName(p, n),
      date: localDay(p.date),
      caption: p.caption,
      subject: p.inhabitantId ? 'habitant' : 'bac',
    })),
    stats: { volumeL: round(tank.volumeNet ?? tank.volumeGross) },
  };
}

export type Dossier = ReturnType<typeof buildDossier>;

export function photoFileName(p: Photo, index: number): string {
  return `photo-${index + 1}-${localDay(p.date)}.jpg`;
}

/** Texte joint au partage : demande d'analyse pour le skill. */
export function diagnosticRequest(
  tankName: string,
  question?: string,
  followUpOf?: string,
): string {
  const q = question?.trim();
  return [
    `Diagnostic de mon aquarium « ${tankName} » avec le skill my-aquarium-diagnostic.`,
    ...(followUpOf
      ? [
          `C'est le suivi de ton diagnostic du ${followUpOf} : dis-moi si le plan a fonctionné (voir sinceLastDiagnosis).`,
        ]
      : []),
    q ? `Mon problème : ${q}` : 'Fais un bilan général et dis-moi ce qui peut être amélioré.',
    'Le dossier JSON et les photos sont joints.',
  ].join('\n');
}

// ---------- Préparation du dossier à l'écran ----------

/** Suivi coché par défaut si le dernier diagnostic du bac date de moins de 90 jours. */
export function followUpByDefault(previous: Diagnosis | undefined, today: string): boolean {
  return !!previous && daysBetween(localDay(previous.date), today) <= 90;
}

/** « suivi prévu dans 3 j » / « aujourd’hui » / « le jeu. 5 nov. » (vide si le diagnostic n'a pas prévu de suivi). */
export function followUpDueLabel(
  previous: Diagnosis | undefined,
  today: string,
  formatDate: (iso: string) => string,
): string {
  if (!previous?.followUp) return '';
  const due = addDays(localDay(previous.date), previous.followUp.inDays);
  const days = daysBetween(today, due);
  return days > 0
    ? `suivi prévu dans ${days} j`
    : days === 0
      ? 'suivi prévu aujourd’hui'
      : `suivi prévu le ${formatDate(due)}`;
}

/**
 * Photos cochées par défaut (au plus 3). Sans suivi : les plus récentes. En suivi : celles prises depuis
 * le diagnostic précédent, plus la dernière d'avant pour comparer. `photos` : de la plus récente à la plus ancienne.
 */
export function defaultPhotoSelection(
  photos: Photo[],
  previous: Diagnosis | undefined,
  followUp: boolean,
): Set<string> {
  if (!followUp || !previous) return new Set(photos.slice(0, 3).map((p) => p.id));
  const after = photos.filter((p) => p.date > previous.date).slice(0, 3);
  const before = photos.find((p) => p.date <= previous.date);
  return new Set([...after, ...(before ? [before] : [])].map((p) => p.id));
}

/** Informations absentes du dossier qui limiteraient l'analyse. */
export function missingInfo(
  dossier: Pick<Dossier, 'water' | 'equipment'>,
  selectedPhotos: number,
): string[] {
  const out: string[] = [];
  const last = dossier.water.tests.at(-1)?.values ?? {};
  if (!dossier.water.tests.length) out.push('relevés d’eau');
  else {
    if (last.no3 == null) out.push('NO3');
    if (last.po4 == null) out.push('PO4');
    if (last.kh == null) out.push('KH');
  }
  if (!dossier.equipment.some((e) => e.light?.schedule))
    out.push('horaires d’éclairage (Matériel)');
  if (!dossier.equipment.some((e) => e.filter?.flowLh)) out.push('débit du filtre');
  if (!selectedPhotos) out.push('photos');
  return out;
}

/** Nom de fichier du dossier : dossier-<bac>-<jour>.json */
export function dossierFileName(tankName: string, today: string): string {
  const slug = tankName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `dossier-${slug}-${today}.json`;
}
