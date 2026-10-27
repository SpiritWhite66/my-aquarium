import { describe, expect, it } from 'vitest';
import {
  SETTING_LABELS,
  algaeScore,
  changeEffect,
  describeChange,
  diffSettings,
  effectVerdict,
  type ChangeEffect,
} from './settings-history';
import type { Equipment, Observation, Photo, SettingChange } from './models';

const DAY = 864e5;
const U = '';

describe('diffSettings', () => {
  const light = (l: NonNullable<Equipment['light']>): Partial<Equipment> => ({ light: l });

  it('ne signale rien quand rien ne change, ou sans réglages', () => {
    expect(diffSettings({}, {})).toEqual([]);
    expect(diffSettings(light({ intensityPct: 80 }), light({ intensityPct: 80 }))).toEqual([]);
  });

  it('formate l’intensité, y compris zéro', () => {
    expect(diffSettings(light({ intensityPct: 80 }), light({ intensityPct: 60 }))).toEqual([
      { field: 'light.intensityPct', from: '80 %', to: '60 %' },
    ]);
    expect(diffSettings(light({ intensityPct: 80 }), light({ intensityPct: 0 }))[0].to).toBe('0 %');
    expect(diffSettings({}, light({ intensityPct: 50 }))).toEqual([
      { field: 'light.intensityPct', from: undefined, to: '50 %' },
    ]);
    expect(diffSettings(light({ intensityPct: 50 }), light({}))[0]).toEqual({
      field: 'light.intensityPct',
      from: '50 %',
      to: undefined,
    });
  });

  it('un horaire n’existe que complet', () => {
    expect(
      diffSettings({}, light({ schedule: { on: '10:00', off: '18:00' } })).find(
        (d) => d.field === 'light.schedule',
      ),
    ).toEqual({ field: 'light.schedule', from: undefined, to: '10:00–18:00' });
    const sched = (l: NonNullable<Equipment['light']>) =>
      diffSettings({}, light(l)).find((d) => d.field === 'light.schedule');
    expect(sched({ schedule: { on: '10:00', off: '' } })).toBeUndefined();
    expect(sched({ schedule: { on: '', off: '18:00' } })).toBeUndefined();
    expect(diffSettings({}, light({ siesta: { on: '13:00', off: '15:00' } }))).toEqual([
      { field: 'light.siesta', from: undefined, to: '13:00–15:00' },
    ]);
  });

  it('un changement d’horaire change aussi la durée d’éclairage, dans l’ordre des réglages suivis', () => {
    const d = diffSettings(
      light({ schedule: { on: '10:00', off: '18:00' } }),
      light({ schedule: { on: '10:00', off: '17:00' } }),
    );
    expect(d).toEqual([
      { field: 'light.schedule', from: '10:00–18:00', to: '10:00–17:00' },
      { field: 'light.photoperiod', from: '8 h', to: '7 h' },
    ]);
  });

  it('suit le lever/coucher, le CO2, le chauffage et le débit du filtre', () => {
    expect(diffSettings(light({ rampMinutes: 30 }), light({ rampMinutes: 45 }))).toEqual([
      { field: 'light.rampMinutes', from: '30 min', to: '45 min' },
    ]);
    expect(diffSettings(light({ rampMinutes: 0 }), light({ rampMinutes: 10 }))[0].from).toBe(
      '0 min',
    );
    expect(
      diffSettings(
        { co2: { schedule: { on: '08:00', off: '17:00' } } },
        { co2: { schedule: { on: '09:00', off: '17:00' } } },
      ),
    ).toEqual([{ field: 'co2.schedule', from: '08:00–17:00', to: '09:00–17:00' }]);
    expect(diffSettings({ heater: { setpointC: 24 } }, { heater: { setpointC: 25.5 } })).toEqual([
      { field: 'heater.setpointC', from: '24 °C', to: '25,5 °C' },
    ]);
    expect(diffSettings({ heater: { setpointC: 0 } }, { heater: { setpointC: 1 } })[0].from).toBe(
      '0 °C',
    );
    expect(diffSettings({ filter: { flowLh: 600 } }, { filter: { flowLh: 900 } })).toEqual([
      { field: 'filter.flowLh', from: '600 L/h', to: '900 L/h' },
    ]);
    expect(diffSettings({ filter: { flowLh: 0 } }, { filter: { flowLh: 5 } })[0].from).toBe(
      '0 L/h',
    );
  });

  it('donne un libellé à chaque réglage et le décrit', () => {
    expect(SETTING_LABELS).toEqual({
      'light.intensityPct': 'Intensité',
      'light.schedule': 'Horaires d’éclairage',
      'light.siesta': 'Sieste',
      'light.photoperiod': 'Durée d’éclairage',
      'light.rampMinutes': 'Lever / coucher',
      'co2.schedule': 'Horaires CO2',
      'heater.setpointC': 'Consigne chauffage',
      'filter.flowLh': 'Débit du filtre',
    });
    expect(describeChange({ field: 'light.intensityPct', from: '80 %', to: '60 %' })).toBe(
      'Intensité : 80 % → 60 %',
    );
    expect(describeChange({ field: 'co2.schedule', from: undefined, to: '08:00–17:00' })).toBe(
      'Horaires CO2 : — → 08:00–17:00',
    );
    expect(describeChange({ field: 'co2.schedule', from: '08:00–17:00', to: undefined })).toBe(
      'Horaires CO2 : 08:00–17:00 → —',
    );
  });
});

describe('algaeScore', () => {
  const o = (x: Partial<Observation>): Observation => ({
    id: 'o',
    updatedAt: U,
    tankId: 'a',
    date: '2026-10-01',
    overall: 'watch',
    findings: [],
    ...x,
  });
  const f = (severity: 'info' | 'warn' | 'danger', extra = {}) =>
    ({ category: 'algae' as const, severity, title: 't', ...extra }) as never;

  it('préfère la note manuelle, même zéro', () => {
    expect(algaeScore(o({ algaeLevel: 2, findings: [f('danger')] }))).toBe(2);
    expect(algaeScore(o({ algaeLevel: 0, findings: [f('danger')] }))).toBe(0);
  });

  it('sinon retient la gravité la plus forte des algues non résolues', () => {
    expect(algaeScore(o({}))).toBe(0);
    expect(algaeScore(o({ findings: [f('info')] }))).toBe(1);
    expect(algaeScore(o({ findings: [f('warn')] }))).toBe(2);
    expect(algaeScore(o({ findings: [f('danger')] }))).toBe(3);
    expect(algaeScore(o({ findings: [f('info'), f('danger'), f('warn')] }))).toBe(3);
    expect(algaeScore(o({ findings: [f('warn'), f('info')] }))).toBe(2);
  });

  it('ignore les constats résolus et ceux qui ne sont pas des algues', () => {
    expect(algaeScore(o({ findings: [f('danger', { resolved: true })] }))).toBe(0);
    expect(algaeScore(o({ findings: [f('danger', { category: 'plant_health' })] }))).toBe(0);
    expect(algaeScore(o({ findings: [f('danger', { resolved: true }), f('info')] }))).toBe(1);
  });
});

describe('changeEffect', () => {
  const AT = Date.parse('2026-10-10T00:00:00Z');
  const iso = (t: number) => new Date(t).toISOString();
  const change = (o: Partial<SettingChange> = {}): SettingChange => ({
    id: 'c',
    updatedAt: U,
    tankId: 'a',
    equipmentId: 'e',
    equipmentName: 'Rampe',
    date: iso(AT),
    field: 'light.intensityPct',
    ...o,
  });
  const obs = (id: string, t: number, level: number, tankId = 'a'): Observation => ({
    id,
    updatedAt: U,
    tankId,
    date: iso(t),
    overall: 'watch',
    findings: [],
    algaeLevel: level as 0,
  });
  const photo = (id: string, t: number, o: Partial<Photo> = {}): Photo => ({
    id,
    updatedAt: U,
    tankId: 'a',
    date: iso(t),
    width: 1,
    height: 1,
    ...o,
  });
  const NOW = new Date(AT + 60 * DAY);

  it('regroupe les notes des 30 jours avant et après, bornes comprises à gauche', () => {
    const observations = [
      obs('far', AT - 31 * DAY, 3),
      obs('b1', AT - 30 * DAY, 1),
      obs('b2', AT - DAY, 2),
      obs('at', AT, 3),
      obs('a1', AT + 29 * DAY, 1),
      obs('end', AT + 30 * DAY, 3),
      obs('other', AT - DAY, 3, 'b'),
    ];
    const e = changeEffect(change(), observations, [], NOW);
    expect(e.before).toEqual({ checks: 2, level: 1.5 });
    expect(e.after).toEqual({ checks: 2, level: 2 });
  });

  it('arrondit la moyenne à une décimale ; sans note le niveau est zéro', () => {
    const e = changeEffect(
      change(),
      [obs('1', AT + DAY, 1), obs('2', AT + 2 * DAY, 1), obs('3', AT + 3 * DAY, 2)],
      [],
      NOW,
    );
    expect(e.after).toEqual({ checks: 3, level: 1.3 });
    expect(e.before).toEqual({ checks: 0, level: 0 });
  });

  it('l’après s’arrête au changement suivant, à la fenêtre donnée et à maintenant', () => {
    const observations = [
      obs('1', AT + 5 * DAY, 1),
      obs('2', AT + 12 * DAY, 3),
      obs('3', AT + 40 * DAY, 3),
    ];
    expect(changeEffect(change(), observations, [], NOW, iso(AT + 10 * DAY)).after).toEqual({
      checks: 1,
      level: 1,
    });
    expect(changeEffect(change(), observations, [], NOW, undefined, 7).after.checks).toBe(1);
    expect(changeEffect(change(), observations, [], NOW, undefined, 60).after.checks).toBe(3);
    expect(changeEffect(change(), observations, [], new Date(AT + 6 * DAY)).after.checks).toBe(1);
    expect(
      changeEffect(change(), [obs('now', AT + 6 * DAY, 2)], [], new Date(AT + 6 * DAY)).after
        .checks,
    ).toBe(1);
    expect(
      changeEffect(change(), [obs('now', AT + 6 * DAY + 1, 2)], [], new Date(AT + 6 * DAY)).after
        .checks,
    ).toBe(0);
  });

  it('la fenêtre d’avant suit aussi la durée demandée', () => {
    const observations = [obs('1', AT - 10 * DAY, 2), obs('2', AT - 2 * DAY, 2)];
    expect(changeEffect(change(), observations, [], NOW, undefined, 5).before.checks).toBe(1);
  });

  it('retient la dernière photo du bac avant et après, sans les photos d’habitants ni d’autres bacs', () => {
    const photos = [
      photo('old', AT - 5 * DAY),
      photo('b2', AT - DAY),
      photo('hab', AT - DAY / 2, { inhabitantId: 'i' }),
      photo('oth', AT - DAY / 3, { tankId: 'b' }),
      photo('x', AT),
      photo('a1', AT + 3 * DAY),
      photo('a2', AT + 9 * DAY),
      photo('late', AT + 40 * DAY),
      photo('ahab', AT + 10 * DAY, { inhabitantId: 'i' }),
    ];
    const e = changeEffect(change(), photos.length ? [] : [], photos.reverse(), NOW);
    expect(e.photoBefore?.id).toBe('b2');
    expect(e.photoAfter?.id).toBe('a2');
    const none = changeEffect(change(), [], [], NOW);
    expect(none.photoBefore).toBeUndefined();
    expect(none.photoAfter).toBeUndefined();
  });

  it('une photo prise à l’instant du changement compte après, pas avant', () => {
    const e = changeEffect(change(), [], [photo('exact', AT)], NOW);
    expect(e.photoBefore).toBeUndefined();
    expect(e.photoAfter?.id).toBe('exact');
  });

  it('compte les jours écoulés', () => {
    expect(changeEffect(change(), [], [], new Date(AT + 12.9 * DAY)).daysSince).toBe(12);
    expect(changeEffect(change(), [], [], NOW).daysSince).toBe(60);
  });
});

describe('effectVerdict', () => {
  const effect = (
    o: Partial<ChangeEffect> & { b?: [number, number]; a?: [number, number] },
  ): ChangeEffect => ({
    before: { checks: o.b?.[0] ?? 2, level: o.b?.[1] ?? 2 },
    after: { checks: o.a?.[0] ?? 2, level: o.a?.[1] ?? 2 },
    daysSince: o.daysSince ?? 20,
  });

  it('attend dix jours avant de juger, même sans notes', () => {
    expect(effectVerdict(effect({ daysSince: 9, b: [0, 0] }))).toEqual({
      level: 'info',
      text: 'Trop tôt pour juger (9 j). Les algues réagissent en 2 à 3 semaines.',
    });
    expect(effectVerdict(effect({ daysSince: 10 })).text).not.toContain('Trop tôt');
  });

  it('demande des notes des deux côtés', () => {
    const text = 'Pas assez de notes d’algues avant et après pour comparer.';
    expect(effectVerdict(effect({ b: [0, 0] }))).toEqual({ level: 'info', text });
    expect(effectVerdict(effect({ a: [0, 0] }))).toEqual({ level: 'info', text });
  });

  it('conclut prudemment selon l’écart de niveau', () => {
    expect(effectVerdict(effect({ b: [2, 2], a: [2, 1.5] }))).toEqual({
      level: 'ok',
      text: 'Moins d’algues : niveau moyen 2/3 avant, 1,5/3 après.',
    });
    expect(effectVerdict(effect({ b: [2, 2], a: [2, 2.5] }))).toEqual({
      level: 'warn',
      text: 'Plus d’algues : niveau moyen 2/3 avant, 2,5/3 après.',
    });
    expect(effectVerdict(effect({ b: [2, 2], a: [2, 1.6] }))).toEqual({
      level: 'info',
      text: 'Pas de différence nette : niveau moyen 2/3 avant, 1,6/3 après.',
    });
    expect(effectVerdict(effect({ b: [2, 2], a: [2, 2.4] })).level).toBe('info');
    expect(effectVerdict(effect({ b: [2, 2], a: [2, 2] })).level).toBe('info');
  });
});
