import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  DIGEST_DAYS,
  STALE_DIGEST,
  digestFor,
  digestsAhead,
  followUpsDue,
  shouldNotify,
  type NotificationPrefs,
} from './reminders';
import type { Diagnosis, MaintenanceTask, Tank } from './models';

const U = '';
const tank = (id: string, name: string, archived = false): Tank => ({
  id,
  updatedAt: U,
  name,
  type: 'planted',
  volumeGross: 60,
  startDate: '2026-01-01',
  co2: false,
  archived,
});
const task = (
  label: string,
  nextDue: string,
  o: Partial<MaintenanceTask> = {},
): MaintenanceTask => ({
  id: label,
  updatedAt: U,
  tankId: 'a',
  type: 'custom',
  label,
  everyDays: 7,
  nextDue,
  active: true,
  ...o,
});
const diag = (id: string, date: string, inDays?: number, tankId = 'a'): Diagnosis => ({
  id,
  updatedAt: U,
  tankId,
  date,
  summary: '',
  hypotheses: [],
  actions: [],
  followUp: inDays == null ? undefined : { inDays },
});
const PREFS = { tasks: true, followUps: true };

describe('followUpsDue', () => {
  it('retient le suivi du dernier diagnostic de chaque bac, une fois l’échéance atteinte', () => {
    const list = [diag('1', '2026-10-01T10:00:00Z', 7), diag('2', '2026-10-10T10:00:00Z', 7)];
    expect(followUpsDue(list, '2026-10-16').map((d) => d.id)).toEqual([]);
    expect(followUpsDue(list, '2026-10-17').map((d) => d.id)).toEqual(['2']);
    expect(followUpsDue(list, '2026-10-30').map((d) => d.id)).toEqual(['2']);
  });

  it('un diagnostic plus récent sans suivi efface l’ancien suivi', () => {
    expect(
      followUpsDue(
        [diag('1', '2026-10-01T10:00:00Z', 1), diag('2', '2026-10-05T10:00:00Z')],
        '2026-10-30',
      ),
    ).toEqual([]);
  });

  it('l’ordre de la liste ne change pas le dernier diagnostic', () => {
    expect(
      followUpsDue(
        [diag('2', '2026-10-10T10:00:00Z', 7), diag('1', '2026-10-01T10:00:00Z', 1)],
        '2026-10-30',
      ).map((d) => d.id),
    ).toEqual(['2']);
  });

  it('à date égale, le premier est gardé', () => {
    expect(
      followUpsDue(
        [diag('1', '2026-10-01T10:00:00Z', 1), diag('2', '2026-10-01T10:00:00Z', 30)],
        '2026-10-05',
      ).map((d) => d.id),
    ).toEqual(['1']);
  });

  it('traite chaque bac séparément', () => {
    const list = [diag('1', '2026-10-01T10:00:00Z', 1), diag('2', '2026-10-01T10:00:00Z', 1, 'b')];
    expect(followUpsDue(list, '2026-10-05').map((d) => d.id)).toEqual(['1', '2']);
  });

  it('compte l’échéance depuis le jour local du diagnostic', () => {
    const late = new Date(2026, 9, 1, 23, 30).toISOString();
    expect(followUpsDue([diag('1', late, 2)], '2026-10-03').map((d) => d.id)).toEqual(['1']);
    expect(followUpsDue([diag('1', late, 2)], '2026-10-02')).toEqual([]);
  });
});

describe('digestFor', () => {
  const one = [tank('a', 'Salon')];
  const two = [tank('a', 'Salon'), tank('b', 'Nano')];

  it('ne dit rien quand il n’y a rien à faire', () => {
    expect(
      digestFor('2026-10-27', { tasks: [], diagnoses: [], tanks: one }, PREFS),
    ).toBeUndefined();
    expect(
      digestFor(
        '2026-10-27',
        { tasks: [task('Eau', '2026-10-28')], diagnoses: [], tanks: one },
        PREFS,
      ),
    ).toBeUndefined();
  });

  it('annonce une tâche due, sans nom de bac quand il n’y en a qu’un', () => {
    expect(
      digestFor(
        '2026-10-27',
        { tasks: [task('Eau', '2026-10-27')], diagnoses: [], tanks: one },
        PREFS,
      ),
    ).toEqual({ title: 'Une chose à faire pour tes bacs', body: 'Eau' });
    expect(
      digestFor(
        '2026-10-27',
        { tasks: [task('Eau', '2026-10-01')], diagnoses: [], tanks: one },
        PREFS,
      )?.body,
    ).toBe('Eau');
  });

  it('précise le bac quand il y en a plusieurs', () => {
    const d = digestFor(
      '2026-10-27',
      {
        tasks: [task('Eau', '2026-10-27'), task('Test', '2026-10-27', { tankId: 'b' })],
        diagnoses: [],
        tanks: two,
      },
      PREFS,
    )!;
    expect(d).toEqual({
      title: '2 choses à faire pour tes bacs',
      body: 'Eau (Salon)\nTest (Nano)',
    });
  });

  it('ignore les tâches inactives, d’un bac archivé ou inconnu', () => {
    const tanks = [tank('a', 'Salon'), tank('z', 'Vieux', true)];
    const tasks = [
      task('Off', '2026-10-01', { active: false }),
      task('Archivé', '2026-10-01', { tankId: 'z' }),
      task('Inconnu', '2026-10-01', { tankId: 'x' }),
    ];
    expect(digestFor('2026-10-27', { tasks, diagnoses: [], tanks }, PREFS)).toBeUndefined();
    expect(
      digestFor(
        '2026-10-27',
        { tasks: [...tasks, task('Ok', '2026-10-01')], diagnoses: [], tanks },
        PREFS,
      )?.body,
    ).toBe('Ok');
  });

  it('un bac archivé ne compte pas pour décider d’afficher les noms de bac', () => {
    const tanks = [tank('a', 'Salon'), tank('z', 'Vieux', true)];
    expect(
      digestFor('2026-10-27', { tasks: [task('Eau', '2026-10-27')], diagnoses: [], tanks }, PREFS)
        ?.body,
    ).toBe('Eau');
  });

  it('liste quatre tâches puis résume les autres', () => {
    const tasks = Array.from({ length: 6 }, (_, n) => task(`T${n + 1}`, '2026-10-27'));
    expect(digestFor('2026-10-27', { tasks, diagnoses: [], tanks: one }, PREFS)).toEqual({
      title: '6 choses à faire pour tes bacs',
      body: 'T1\nT2\nT3\nT4\net 2 autre(s)',
    });
    expect(
      digestFor('2026-10-27', { tasks: tasks.slice(0, 4), diagnoses: [], tanks: one }, PREFS)?.body,
    ).toBe('T1\nT2\nT3\nT4');
    expect(
      digestFor('2026-10-27', { tasks: tasks.slice(0, 5), diagnoses: [], tanks: one }, PREFS)?.body,
    ).toBe('T1\nT2\nT3\nT4\net 1 autre(s)');
  });

  it('ajoute les suivis de diagnostic des bacs actifs', () => {
    const diagnoses = [
      diag('1', '2026-10-10T10:00:00Z', 7),
      diag('2', '2026-10-10T10:00:00Z', 7, 'z'),
    ];
    const tanks = [tank('a', 'Salon'), tank('z', 'Vieux', true)];
    expect(
      digestFor('2026-10-27', { tasks: [task('Eau', '2026-10-27')], diagnoses, tanks }, PREFS),
    ).toEqual({
      title: '2 choses à faire pour tes bacs',
      body: 'Eau\nSuivi du diagnostic : Salon',
    });
  });

  it('respecte les préférences', () => {
    const data = {
      tasks: [task('Eau', '2026-10-27')],
      diagnoses: [diag('1', '2026-10-10T10:00:00Z', 7)],
      tanks: one,
    };
    expect(digestFor('2026-10-27', data, { tasks: false, followUps: true })).toEqual({
      title: 'Une chose à faire pour tes bacs',
      body: 'Suivi du diagnostic : Salon',
    });
    expect(digestFor('2026-10-27', data, { tasks: true, followUps: false })?.body).toBe('Eau');
    expect(digestFor('2026-10-27', data, { tasks: false, followUps: false })).toBeUndefined();
  });
});

describe('digestsAhead', () => {
  const data = { tasks: [task('Eau', '2026-10-29')], diagnoses: [], tanks: [tank('a', 'Salon')] };

  it('prépare les jours à partir d’aujourd’hui, seulement ceux qui ont quelque chose', () => {
    const out = digestsAhead('2026-10-27', data, PREFS, 5);
    expect(Object.keys(out)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
    expect(out['2026-10-29'].body).toBe('Eau');
  });

  it('couvre bien le nombre de jours demandé', () => {
    expect(Object.keys(digestsAhead('2026-10-27', data, PREFS, 2))).toEqual([]);
    expect(Object.keys(digestsAhead('2026-10-27', data, PREFS, 3))).toEqual(['2026-10-29']);
    expect(
      Object.keys(
        digestsAhead('2026-10-27', { ...data, tasks: [task('Eau', '2026-10-01')] }, PREFS),
      ),
    ).toHaveLength(DIGEST_DAYS);
    expect(DIGEST_DAYS).toBe(30);
  });
});

describe('shouldNotify', () => {
  const digest = { title: 'T', body: 'B' };
  const prefs = (o: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
    ...DEFAULT_PREFS,
    enabled: true,
    time: '09:00',
    digests: { '2026-10-27': digest },
    ...o,
  });
  const at = (h: number, m: number) => new Date(2026, 9, 27, h, m);

  it('affiche le rappel du jour à l’heure prévue, ni avant ni s’il est désactivé ou déjà montré', () => {
    expect(shouldNotify(prefs(), at(9, 0), '2026-10-27')).toBe(digest);
    expect(shouldNotify(prefs(), at(23, 59), '2026-10-27')).toBe(digest);
    expect(shouldNotify(prefs(), at(8, 59), '2026-10-27')).toBeUndefined();
    expect(shouldNotify(prefs({ enabled: false }), at(10, 0), '2026-10-27')).toBeUndefined();
    expect(
      shouldNotify(prefs({ lastShown: '2026-10-27' }), at(10, 0), '2026-10-27'),
    ).toBeUndefined();
    expect(shouldNotify(prefs({ lastShown: '2026-10-26' }), at(10, 0), '2026-10-27')).toBe(digest);
  });

  it('compare les heures sur deux chiffres', () => {
    expect(shouldNotify(prefs({ time: '10:30' }), at(9, 45), '2026-10-27')).toBeUndefined();
    expect(shouldNotify(prefs({ time: '09:05' }), at(9, 4), '2026-10-27')).toBeUndefined();
    expect(shouldNotify(prefs({ time: '09:05' }), at(9, 5), '2026-10-27')).toBe(digest);
  });

  it('reste silencieux un jour sans rappel tant que la préparation couvre ce jour', () => {
    expect(
      shouldNotify(prefs({ digests: {}, digestsUntil: '2026-10-27' }), at(10, 0), '2026-10-27'),
    ).toBeUndefined();
    expect(
      shouldNotify(prefs({ digests: {}, digestsUntil: '2026-10-28' }), at(10, 0), '2026-10-27'),
    ).toBeUndefined();
    expect(
      shouldNotify(prefs({ digests: undefined, digestsUntil: undefined }), at(10, 0), '2026-10-27'),
    ).toBeUndefined();
  });

  it('prévient quand la préparation est épuisée', () => {
    expect(
      shouldNotify(prefs({ digests: {}, digestsUntil: '2026-10-26' }), at(10, 0), '2026-10-27'),
    ).toBe(STALE_DIGEST);
    expect(
      shouldNotify(
        prefs({ digests: undefined, digestsUntil: '2026-10-26' }),
        at(10, 0),
        '2026-10-27',
      ),
    ).toBe(STALE_DIGEST);
  });

  it('a des réglages par défaut raisonnables', () => {
    expect(DEFAULT_PREFS).toEqual({
      id: 'notifications',
      enabled: false,
      time: '09:00',
      tasks: true,
      followUps: true,
    });
    expect(STALE_DIGEST.title).toBe('Rappels à mettre à jour');
  });
});
