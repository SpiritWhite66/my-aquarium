// Cas limites des calculs d'aide à la décision, avec des valeurs calculées à la main.
import { describe, expect, it } from 'vitest';
import type { Consumable, Equipment, MaintenanceTask, Tank, WaterTest } from './models';
import {
  CO2_TARGET,
  CYCLING_LABELS,
  DROP_CHECKER,
  afterWaterChange,
  bpmFromTaps,
  co2Advice,
  co2FromKhPh,
  co2FromPhDrop,
  co2Status,
  cyclingPhase,
  gearChecks,
  latestKhPh,
  percentFromLabel,
  photoperiod,
  scheduleHours,
  stockAlerts,
  tasksToIcs,
  trendOf,
  warrantyEnd,
} from './insights';

const wt = (date: string, values: WaterTest['values']): WaterTest => ({
  id: date,
  updatedAt: '',
  tankId: 't',
  date,
  values,
});
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const NOW = Date.UTC(2026, 9, 31);

describe('percentFromLabel', () => {
  it.each([
    ['Changement d’eau 30 %', 30],
    ['Changement 50%', 50],
    ['Changement 25   %', 25],
    ['Changement d’eau', 30],
    ['0 %', 1],
    ['250 %', 100],
    ['100 %', 100],
    ['1 %', 1],
  ])('%s → %i', (label, expected) => expect(percentFromLabel(label)).toBe(expected));

  it('utilise la valeur par défaut donnée', () =>
    expect(percentFromLabel('sans pourcentage', 40)).toBe(40));
});

describe('afterWaterChange', () => {
  it.each([
    [20, 0.5, 0, 10],
    [20, 0.5, 10, 15],
    [20, 0, 0, 20],
    [20, 1, 0, 0],
    [20, 2, 0, 0],
    [20, -1, 0, 20],
    [10, 0.33, 0, 6.7],
    [7, 0.1, 0, 6.3],
    [0, 0.5, 4, 2],
  ])('valeur %d, part %d, robinet %d → %d', (v, f, tap, expected) =>
    expect(afterWaterChange(v, f, tap)).toBe(expected),
  );
});

describe('trendOf', () => {
  const weekly = (values: number[], key: 'no3' = 'no3') =>
    values.map((v, i) => wt(day(i * 7), { [key]: v }));
  const range = { min: 5, max: 40 };

  it('détecte une hausse et compte les jours avant de dépasser le maximum', () => {
    expect(trendOf(weekly([10, 15, 20, 25]), 'no3', { min: 0, max: 40 }, 60, NOW)).toEqual({
      perWeek: 5,
      last: 25,
      daysToLimit: 21,
      limit: 'max',
    });
  });

  it('détecte une baisse et compte les jours avant de passer sous le minimum', () => {
    expect(trendOf(weekly([25, 20, 15, 10]), 'no3', range, 60, NOW)).toEqual({
      perWeek: -5,
      last: 10,
      daysToLimit: 7,
      limit: 'min',
    });
  });

  it('ne donne pas d’échéance quand la valeur est déjà hors plage', () => {
    const up = trendOf(weekly([30, 35, 40, 45]), 'no3', range, 60, NOW)!;
    expect(up).toEqual({ perWeek: 5, last: 45 });
    const down = trendOf(weekly([20, 15, 10, 5]), 'no3', { min: 8, max: 40 }, 60, NOW)!;
    expect(down).toEqual({ perWeek: -5, last: 5 });
  });

  it('une valeur pile au bout de la plage donne zéro jour', () => {
    expect(trendOf(weekly([25, 30, 35, 40]), 'no3', range, 60, NOW)).toMatchObject({
      daysToLimit: 0,
      limit: 'max',
    });
    expect(trendOf(weekly([20, 15, 10, 5]), 'no3', range, 60, NOW)).toMatchObject({
      daysToLimit: 0,
      limit: 'min',
    });
  });

  it('sans plage, juge la tendance sur la valeur actuelle et n’annonce pas d’échéance', () => {
    expect(trendOf(weekly([10, 15, 20, 25]), 'no3', undefined, 60, NOW)).toEqual({
      perWeek: 5,
      last: 25,
    });
    expect(trendOf(weekly([24, 24.5, 25, 25.5]), 'no3', undefined, 60, NOW)).toBeUndefined();
  });

  it('une tendance trop faible face à la plage est ignorée', () => {
    expect(
      trendOf(weekly([10, 10.5, 11, 11.5]), 'no3', { min: 0, max: 100 }, 60, NOW),
    ).toBeUndefined();
    expect(
      trendOf(weekly([10, 15.25, 20.5, 25.75]), 'no3', { min: 0, max: 100 }, 60, NOW),
    ).toMatchObject({ perWeek: 5.3 });
  });

  it('exige trois mesures dans la période, du paramètre demandé', () => {
    expect(trendOf(weekly([10, 20]), 'no3', range, 60, NOW)).toBeUndefined();
    expect(trendOf(weekly([10, 20, 30]), 'no3', range, 60, NOW)).toBeDefined();
    const old = [
      wt(day(-100), { no3: 1 }),
      wt(day(-90), { no3: 2 }),
      wt(day(20), { no3: 30 }),
      wt(day(27), { no3: 40 }),
    ];
    expect(trendOf(old, 'no3', range, 60, NOW)).toBeUndefined();
    expect(trendOf(old, 'no3', range, 365, NOW)).toBeDefined();
    expect(trendOf(weekly([10, 20, 30]), 'ph', range, 60, NOW)).toBeUndefined();
    const holes = [
      wt(day(0), { no3: 10 }),
      wt(day(7), { ph: 7 }),
      wt(day(14), { no3: 20 }),
      wt(day(21), { no3: 30 }),
    ];
    expect(trendOf(holes, 'no3', range, 60, NOW)?.last).toBe(30);
  });

  it('des mesures du même instant ne forment pas de tendance', () => {
    const same = [wt(day(5), { no3: 10 }), wt(day(5), { no3: 20 }), wt(day(5), { no3: 30 })];
    expect(trendOf(same, 'no3', range, 60, NOW)).toBeUndefined();
  });

  it('la fenêtre par défaut est de 60 jours', () => {
    const t = [
      wt(day(-70), { no3: 5 }),
      wt(day(-65), { no3: 20 }),
      wt(day(-62), { no3: 35 }),
      wt(day(20), { no3: 30 }),
    ];
    expect(trendOf(t, 'no3', range, undefined, NOW)).toBeUndefined();
  });
});

describe('cyclingPhase', () => {
  it('sans relevé d’azote, le suivi démarre', () => {
    expect(cyclingPhase([])).toBe('no_data');
    expect(cyclingPhase([wt(day(0), { ph: 7 })])).toBe('no_data');
  });

  it('les nitrites passent avant l’ammonium, aux bons seuils', () => {
    expect(cyclingPhase([wt(day(0), { no2: 0.2 })])).toBe('nitrite');
    expect(cyclingPhase([wt(day(0), { no2: 0.2, nh4: 2 })])).toBe('nitrite');
    expect(cyclingPhase([wt(day(0), { no2: 0.1 })])).toBe('waiting');
    expect(cyclingPhase([wt(day(0), { nh4: 0.3 })])).toBe('ammonia');
    expect(cyclingPhase([wt(day(0), { nh4: 0.25 })])).toBe('waiting');
  });

  it('ne termine qu’après deux mesures propres consécutives avec des nitrates', () => {
    const clean = (d: number, no3 = 5) => wt(day(d), { nh4: 0, no2: 0, no3 });
    expect(cyclingPhase([clean(0), clean(3)])).toBe('done');
    expect(cyclingPhase([clean(3)])).toBe('waiting');
    expect(cyclingPhase([wt(day(0), { nh4: 1, no2: 0, no3: 5 }), clean(3)])).toBe('waiting');
    expect(cyclingPhase([wt(day(0), { nh4: 0.25, no2: 0.1, no3: 5 }), clean(3)])).toBe('done');
    expect(cyclingPhase([clean(0), clean(3, 0)])).toBe('waiting');
    expect(cyclingPhase([clean(0), wt(day(3), { nh4: 0, no2: 0 })])).toBe('waiting');
    expect(cyclingPhase([clean(0), wt(day(3), { nh4: 0, no3: 5 })])).toBe('waiting');
    expect(cyclingPhase([clean(0), wt(day(3), { no2: 0, no3: 5 })])).toBe('waiting');
  });

  it('un relevé sans azote ne compte pas dans les deux derniers', () => {
    const clean = (d: number) => wt(day(d), { nh4: 0, no2: 0, no3: 5 });
    expect(cyclingPhase([clean(0), clean(3), wt(day(4), { ph: 7 })])).toBe('done');
  });

  it('chaque phase a un titre', () => {
    expect(
      Object.fromEntries(Object.entries(CYCLING_LABELS).map(([k, v]) => [k, v.title])),
    ).toEqual({
      no_data: 'Démarrage',
      ammonia: 'Pic d’ammonium',
      nitrite: 'Pic de nitrites',
      waiting: 'En cours',
      done: 'Cyclage terminé',
    });
  });
});

describe('tasksToIcs', () => {
  const tank = { id: 't', name: 'Salon' } as Tank;
  const task = (o: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
    id: 'k1',
    updatedAt: '',
    tankId: 't',
    type: 'water_change',
    label: 'Eau',
    everyDays: 7,
    nextDue: '2026-10-28',
    active: true,
    ...o,
  });
  const NOW_D = new Date('2026-10-27T10:20:30.456Z');
  const lines = (tasks: MaintenanceTask[]) => tasksToIcs(tasks, [tank], NOW_D).split('\r\n');

  it('écrit un calendrier complet avec fins de ligne CRLF', () => {
    const ics = tasksToIcs([task()], [tank], NOW_D);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines([task()])).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//my-aquarium//FR',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Aquariums',
      'BEGIN:VEVENT',
      'UID:k1@my-aquarium',
      'DTSTAMP:20261027T102030Z',
      'DTSTART;VALUE=DATE:20261028',
      'DTEND;VALUE=DATE:20261029',
      'RRULE:FREQ=DAILY;INTERVAL=7',
      'SUMMARY:Eau — Salon',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Eau',
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('saute les tâches inactives et celles d’un bac inconnu', () => {
    expect(
      tasksToIcs([task({ active: false }), task({ tankId: 'x' })], [tank]).includes('VEVENT'),
    ).toBe(false);
    expect(
      tasksToIcs([task({ id: 'a' }), task({ id: 'b' })], [tank]).split('BEGIN:VEVENT'),
    ).toHaveLength(3);
    expect(tasksToIcs([], [tank])).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//my-aquarium//FR\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Aquariums\r\nEND:VCALENDAR\r\n',
    );
  });

  it.each([
    [0, 1],
    [7.9, 7],
    [NaN, 1],
    [-3, 1],
    [1, 1],
    [30, 30],
  ])('fréquence %d → intervalle %d', (every, interval) => {
    expect(lines([task({ everyDays: every })]).find((l) => l.startsWith('RRULE'))).toBe(
      `RRULE:FREQ=DAILY;INTERVAL=${interval}`,
    );
  });

  it('échappe virgules, points-virgules, antislash et retours à la ligne', () => {
    const l = lines([task({ label: 'a,b;c\\d\ne\r\nf' })]);
    expect(l.find((x) => x.startsWith('SUMMARY'))).toBe('SUMMARY:a\\,b\\;c\\\\d\\ne\\nf — Salon');
    expect(l.find((x) => x.startsWith('DESCRIPTION'))).toBe('DESCRIPTION:a\\,b\\;c\\\\d\\ne\\nf');
  });

  it('passe d’un mois à l’autre pour la fin de l’évènement', () => {
    expect(lines([task({ nextDue: '2026-12-31' })]).find((x) => x.startsWith('DTEND'))).toBe(
      'DTEND;VALUE=DATE:20270101',
    );
  });
});

describe('CO2 : compteur de bulles', () => {
  it('calcule les bulles par minute sur les intervalles', () => {
    expect(bpmFromTaps([0, 1000, 2000, 3000, 4000, 5000])).toBe(60);
    expect(bpmFromTaps([0, 1500])).toBe(40);
    expect(bpmFromTaps([1000, 2000, 4000])).toBe(40);
  });

  it('refuse un comptage inexploitable', () => {
    expect(bpmFromTaps([])).toBeUndefined();
    expect(bpmFromTaps([5])).toBeUndefined();
    expect(bpmFromTaps([5, 5])).toBeUndefined();
    expect(bpmFromTaps([9, 5])).toBeUndefined();
  });

  it('décrit les trois couleurs du drop checker', () => {
    expect(DROP_CHECKER.blue).toMatchObject({ label: 'Bleu', level: 'warn' });
    expect(DROP_CHECKER.green).toMatchObject({ label: 'Vert', level: 'ok' });
    expect(DROP_CHECKER.yellow).toMatchObject({ label: 'Jaune', level: 'danger' });
  });

  it('compare à la cible à ±15 %', () => {
    expect(co2Status(50)).toBeUndefined();
    expect(co2Status(50, 0)).toBeUndefined();
    expect(co2Status(84, 100)).toBe('low');
    expect(co2Status(86, 100)).toBe('ok');
    expect(co2Status(100, 100)).toBe('ok');
    expect(co2Status(114, 100)).toBe('ok');
    expect(co2Status(116, 100)).toBe('high');
  });
});

describe('garantie et stocks', () => {
  it('calcule la fin de garantie en mois', () => {
    expect(warrantyEnd({ purchaseDate: '2026-01-15', warrantyMonths: 12 })).toBe('2027-01-15');
    expect(warrantyEnd({ purchaseDate: '2025-11-20', warrantyMonths: 3 })).toBe('2026-02-20');
    expect(warrantyEnd({ purchaseDate: '2026-01-15' })).toBeUndefined();
    expect(warrantyEnd({ purchaseDate: '2026-01-15', warrantyMonths: 0 })).toBeUndefined();
    expect(warrantyEnd({ warrantyMonths: 12 })).toBeUndefined();
  });

  const cons = (o: Partial<Consumable>): Consumable => ({
    id: 'c',
    updatedAt: '',
    name: 'Engrais',
    category: 'fertilizer',
    level: 'full',
    ...o,
  });
  const gear = (o: Partial<Equipment>): Equipment => ({
    id: 'e',
    updatedAt: '',
    type: 'filter',
    name: 'Filtre',
    ...o,
  });
  const today = '2026-10-27';

  it('signale vide et bientôt vide, pas à moitié ou plein', () => {
    expect(stockAlerts([cons({ level: 'empty' })], [], today)).toEqual([
      {
        level: 'warn',
        title: 'Engrais : vide',
        detail: 'À racheter.',
        kind: 'consumable',
        id: 'c',
      },
    ]);
    expect(stockAlerts([cons({ level: 'low' })], [], today)).toEqual([
      {
        level: 'info',
        title: 'Engrais : bientôt vide',
        detail: 'Pense à en racheter.',
        kind: 'consumable',
        id: 'c',
      },
    ]);
    expect(stockAlerts([cons({ level: 'half' }), cons({ level: 'full' })], [], today)).toEqual([]);
  });

  it('signale une péremption passée, plus grave pour un test', () => {
    expect(stockAlerts([cons({ expiryDate: '2026-10-20' })], [], today)).toEqual([
      {
        level: 'warn',
        title: 'Engrais : périmé',
        detail: 'Depuis 7 j.',
        kind: 'consumable',
        id: 'c',
      },
    ]);
    const kit = stockAlerts(
      [cons({ name: 'Test', category: 'test_kit', expiryDate: '2026-10-26' })],
      [],
      today,
    )[0];
    expect(kit).toMatchObject({
      level: 'danger',
      title: 'Test : périmé',
      detail: 'Depuis 1 j. Un test périmé donne des valeurs fausses.',
    });
  });

  it('annonce une péremption dans les 30 jours', () => {
    expect(stockAlerts([cons({ expiryDate: '2026-11-26' })], [], today)).toEqual([
      {
        level: 'info',
        title: 'Engrais : périme bientôt',
        detail: 'Dans 30 j.',
        kind: 'consumable',
        id: 'c',
      },
    ]);
    expect(stockAlerts([cons({ expiryDate: today })], [], today)[0]).toMatchObject({
      title: 'Engrais : périme bientôt',
      detail: 'Dans 0 j.',
    });
    expect(stockAlerts([cons({ expiryDate: '2026-11-27' })], [], today)).toEqual([]);
  });

  it('cumule vide et péremption sur le même produit', () => {
    expect(
      stockAlerts([cons({ level: 'empty', expiryDate: '2026-10-01' })], [], today).map(
        (a) => a.title,
      ),
    ).toEqual(['Engrais : vide', 'Engrais : périmé']);
  });

  it('annonce la fin de garantie dans les 30 jours', () => {
    const e = gear({ purchaseDate: '2025-11-26', warrantyMonths: 12 });
    expect(stockAlerts([], [e], today)).toEqual([
      {
        level: 'info',
        title: 'Garantie : Filtre',
        detail: 'Se termine dans 30 j.',
        kind: 'equipment',
        id: 'e',
      },
    ]);
    expect(
      stockAlerts([], [gear({ purchaseDate: '2025-10-27', warrantyMonths: 12 })], today)[0].detail,
    ).toBe('Se termine dans 0 j.');
    expect(
      stockAlerts([], [gear({ purchaseDate: '2025-10-26', warrantyMonths: 12 })], today),
    ).toEqual([]);
    expect(
      stockAlerts([], [gear({ purchaseDate: '2025-11-27', warrantyMonths: 12 })], today),
    ).toEqual([]);
    expect(stockAlerts([], [gear({})], today)).toEqual([]);
  });

  it('trie du plus grave au moins grave', () => {
    const out = stockAlerts(
      [
        cons({ id: 'a', level: 'low' }),
        cons({ id: 'b', level: 'empty' }),
        cons({ id: 'c', name: 'Test', category: 'test_kit', expiryDate: '2026-01-01' }),
      ],
      [gear({ id: 'g', purchaseDate: '2025-11-01', warrantyMonths: 12 })],
      today,
    );
    expect(out.map((a) => a.level)).toEqual(['danger', 'warn', 'info', 'info']);
    expect(out.map((a) => a.id)).toEqual(['c', 'b', 'a', 'g']);
  });
});

describe('CO2 estimé', () => {
  it('à partir du KH et du pH', () => {
    expect(co2FromKhPh(4, 7)).toBe(12);
    expect(co2FromKhPh(4, 6.6)).toBe(30.1);
    expect(co2FromKhPh(0, 7)).toBeUndefined();
    expect(co2FromKhPh(-1, 7)).toBeUndefined();
    expect(co2FromKhPh(4, 0)).toBeUndefined();
    expect(co2FromKhPh(4, -2)).toBeUndefined();
    expect(co2FromKhPh(NaN, 7)).toBeUndefined();
    expect(co2FromKhPh(4, NaN)).toBeUndefined();
  });

  it('à partir de la baisse de pH', () => {
    expect(co2FromPhDrop(7.4, 6.6)).toEqual({ drop: 0.8, mgL: 18.9 });
    expect(co2FromPhDrop(7, 6)).toEqual({ drop: 1, mgL: 30 });
    expect(co2FromPhDrop(7, 7)).toEqual({ drop: 0, mgL: 3 });
    expect(co2FromPhDrop(7, 7.2)).toEqual({ drop: -0.2, mgL: 3 });
    expect(co2FromPhDrop(0, 6)).toBeUndefined();
    expect(co2FromPhDrop(7, 0)).toBeUndefined();
    expect(co2FromPhDrop(-1, 6)).toBeUndefined();
    expect(co2FromPhDrop(7, -1)).toBeUndefined();
  });

  it('la zone visée est de 20 à 30 mg/L', () => expect(CO2_TARGET).toEqual({ min: 20, max: 30 }));

  it.each([
    [9.9, 'very_low', 'warn', 'CO2 très insuffisant'],
    [10, 'low', 'warn', 'CO2 un peu faible'],
    [19.9, 'low', 'warn', 'CO2 un peu faible'],
    [20, 'ok', 'ok', 'CO2 correct'],
    [35, 'ok', 'ok', 'CO2 correct'],
    [35.1, 'high', 'warn', 'CO2 un peu élevé'],
    [45, 'high', 'warn', 'CO2 un peu élevé'],
    [45.1, 'very_high', 'danger', 'Trop de CO2'],
  ] as const)('%d mg/L → %s', (mg, verdict, level, title) => {
    expect(co2Advice(mg)).toMatchObject({ mgL: mg, verdict, level, title });
  });

  it('conseille un débit par paliers selon le débit actuel', () => {
    expect(co2Advice(5).suggestedBpm).toBeUndefined();
    expect(co2Advice(5, 10).suggestedBpm).toBe(12);
    expect(co2Advice(15, 10).suggestedBpm).toBe(12);
    expect(co2Advice(25, 10).suggestedBpm).toBe(10);
    expect(co2Advice(25).suggestedBpm).toBeUndefined();
    expect(co2Advice(40, 10).suggestedBpm).toBe(9);
    expect(co2Advice(60, 10).suggestedBpm).toBe(7);
    expect(co2Advice(60, 1).suggestedBpm).toBe(1);
    expect(co2Advice(5, 1).suggestedBpm).toBe(1);
  });
});

describe('latestKhPh', () => {
  it('prend le pH le plus récent avec le KH du même relevé', () => {
    expect(latestKhPh([wt(day(0), { kh: 3, ph: 7.2 }), wt(day(5), { kh: 4, ph: 6.8 })])).toEqual({
      kh: 4,
      ph: 6.8,
      date: day(5),
    });
  });

  it('complète avec un KH mesuré dans la semaine, pas au-delà', () => {
    expect(latestKhPh([wt(day(0), { kh: 4 }), wt(day(7), { ph: 6.8 })])).toEqual({
      kh: 4,
      ph: 6.8,
      date: day(7),
    });
    expect(latestKhPh([wt(day(0), { kh: 4 }), wt(day(8), { ph: 6.8 })])).toBeUndefined();
  });

  it('ignore les relevés sans pH et renvoie rien sans données', () => {
    expect(latestKhPh([])).toBeUndefined();
    expect(latestKhPh([wt(day(0), { kh: 4 })])).toBeUndefined();
    expect(latestKhPh([wt(day(0), { kh: 4, ph: 7 }), wt(day(1), { no3: 5 })])).toEqual({
      kh: 4,
      ph: 7,
      date: day(0),
    });
  });

  it('abandonne un KH trop ancien sans chercher plus loin', () => {
    expect(
      latestKhPh([wt(day(0), { kh: 3 }), wt(day(1), { kh: 4 }), wt(day(30), { ph: 7 })]),
    ).toBeUndefined();
  });
});

describe('horaires', () => {
  it.each([
    [{ on: '10:00', off: '18:00' }, 8],
    [{ on: '10:00', off: '18:30' }, 8.5],
    [{ on: '22:00', off: '06:00' }, 8],
    [{ on: '08:00', off: '08:00' }, 24],
    [{ on: '10', off: '12' }, 2],
    [{ on: '10:15', off: '10:30' }, 0.3],
  ])('plage %j → %d h', (s, h) => expect(scheduleHours(s)).toBe(h));

  it('retranche la sieste de la durée d’éclairage', () => {
    expect(photoperiod({})).toBeUndefined();
    expect(photoperiod({ schedule: { on: '10:00', off: '18:00' } })).toBe(8);
    expect(
      photoperiod({
        schedule: { on: '10:00', off: '18:00' },
        siesta: { on: '13:00', off: '15:30' },
      }),
    ).toBe(5.5);
    expect(
      photoperiod({
        schedule: { on: '10:00', off: '11:00' },
        siesta: { on: '12:00', off: '11:00' },
      }),
    ).toBe(0);
  });
});

describe('gearChecks', () => {
  const tank = (o: Partial<Tank> = {}) =>
    ({ id: 't', volumeGross: 60, type: 'planted', co2: false, ...o }) as Tank;
  const light = (on: string, off: string, extra = {}): Equipment => ({
    id: 'l',
    updatedAt: '',
    type: 'light',
    name: 'L',
    light: { schedule: { on, off }, ...extra },
  });
  const filter = (flowLh: number, type: 'filter' | 'pump' = 'filter'): Equipment => ({
    id: `f${flowLh}`,
    updatedAt: '',
    type,
    name: 'F',
    filter: { flowLh },
  });
  const co2 = (o: Partial<Equipment['co2']> = {}): Equipment => ({
    id: 'c',
    updatedAt: '',
    type: 'co2',
    name: 'C',
    co2: o,
  });
  const titles = (t: Tank, g: Equipment[]) => gearChecks(t, g).map((c) => `${c.level}|${c.title}`);

  it('ne dit rien sans matériel', () => expect(gearChecks(tank(), [])).toEqual([]));

  it('juge la durée d’éclairage', () => {
    expect(titles(tank(), [light('10:00', '20:00')])).toEqual([
      'warn|Éclairage long : 10 h par jour',
    ]);
    expect(titles(tank(), [light('10:00', '19:00')])).toEqual(['ok|Éclairage : 9 h par jour']);
    expect(titles(tank(), [light('10:00', '15:00')])).toEqual([
      'info|Éclairage court : 5 h par jour',
    ]);
    expect(titles(tank(), [light('10:00', '16:00')])).toEqual(['ok|Éclairage : 6 h par jour']);
    expect(gearChecks(tank(), [light('10:00', '20:00')])[0].detail).toContain('7 à 8 h');
    expect(gearChecks(tank(), [light('10:00', '15:00')])[0].detail).toContain('manquer de lumière');
    expect(gearChecks(tank(), [light('10:00', '18:30')])[0]).toMatchObject({
      level: 'ok',
      title: 'Éclairage : 8,5 h par jour',
      detail: 'Durée adaptée à un bac planté.',
    });
  });

  it('ignore un éclairage sans horaires', () => {
    expect(
      gearChecks(tank(), [
        { id: 'l', updatedAt: '', type: 'light', name: 'L', light: { intensityPct: 100 } },
      ]),
    ).toEqual([]);
    expect(gearChecks(tank(), [{ id: 'l', updatedAt: '', type: 'light', name: 'L' }])).toEqual([]);
  });

  it('signale une intensité élevée pendant le cyclage seulement', () => {
    const has = (t: Tank, extra: object) =>
      titles(t, [light('10:00', '18:00', extra)]).some((x) => x.includes('Intensité élevée'));
    expect(has(tank({ cycling: true }), { intensityPct: 80 })).toBe(true);
    expect(has(tank({ cycling: true }), {})).toBe(true);
    expect(has(tank({ cycling: true }), { intensityPct: 60 })).toBe(false);
    expect(has(tank({ cycling: false }), { intensityPct: 100 })).toBe(false);
    expect(
      gearChecks(tank({ cycling: true }), [light('10:00', '18:00', { intensityPct: 80 })])[1],
    ).toMatchObject({ level: 'info', detail: expect.stringContaining('40 à 60 %') });
  });

  it('juge le brassage (filtres et pompes) selon le volume net', () => {
    expect(titles(tank(), [filter(180)])).toEqual([
      'warn|Brassage faible : 3 × le volume par heure',
    ]);
    expect(titles(tank(), [filter(240)])).toEqual(['ok|Brassage : 4 × le volume par heure']);
    expect(titles(tank(), [filter(150), filter(150, 'pump')])).toEqual([
      'ok|Brassage : 5 × le volume par heure',
    ]);
    expect(titles(tank({ volumeNet: 50 }), [filter(225)])).toEqual([
      'ok|Brassage : 4,5 × le volume par heure',
    ]);
    expect(titles(tank(), [filter(0)])).toEqual([]);
    expect(titles(tank({ volumeGross: 0 }), [filter(100)])).toEqual([]);
    expect(gearChecks(tank(), [filter(600)])[0].detail).toContain('8 à 10 fois');
    expect(gearChecks(tank({ type: 'community' }), [filter(600)])[0].detail).toBe('Correct.');
    expect(gearChecks(tank(), [filter(180)])[0].detail).toContain('30 à 50 %');
    expect(titles(tank(), [{ id: 'x', updatedAt: '', type: 'filter', name: 'F' }])).toEqual([]);
  });

  describe('synchronisation du CO2 et de la lumière', () => {
    const sync = (coOn: string, coOff: string) =>
      titles(tank({ co2: true }), [
        light('10:00', '18:00'),
        co2({ schedule: { on: coOn, off: coOff } }),
      ]).filter((t) => !t.includes('Éclairage'));
    it('valide un CO2 lancé 2 h avant et coupé avant la lumière', () => {
      expect(sync('08:00', '17:00')).toEqual(['ok|CO2 synchronisé avec la lumière']);
      const c = gearChecks(tank({ co2: true }), [
        light('10:00', '18:00'),
        co2({ schedule: { on: '08:00', off: '17:00' } }),
      ]).at(-1)!;
      expect(c.detail).toBe('Démarre 2 h avant l’allumage.');
      const c2 = gearChecks(tank({ co2: true }), [
        light('10:00', '18:00'),
        co2({ schedule: { on: '09:00', off: '18:00' } }),
      ]).at(-1)!;
      expect(c2.detail).toBe('Démarre 1 h avant l’allumage.');
    });
    it('signale un démarrage trop tardif (moins de 30 min d’avance)', () => {
      expect(sync('09:31', '17:00')).toEqual(['warn|CO2 démarré trop tard']);
      expect(sync('09:30', '17:00')).toEqual(['ok|CO2 synchronisé avec la lumière']);
    });
    it('signale un CO2 encore actif après l’extinction', () => {
      expect(sync('08:00', '18:01')).toEqual(['warn|CO2 encore actif après l’extinction']);
      expect(sync('08:00', '18:00')).toEqual(['ok|CO2 synchronisé avec la lumière']);
    });
    it('cumule les deux avertissements', () => {
      expect(sync('10:00', '19:00')).toEqual([
        'warn|CO2 démarré trop tard',
        'warn|CO2 encore actif après l’extinction',
      ]);
    });
  });

  describe('CO2 sans programmation', () => {
    it('signale l’absence d’électrovanne pour un bac sous CO2', () => {
      expect(titles(tank({ co2: true }), [co2({})])).toEqual(['info|CO2 sans électrovanne']);
      expect(
        titles(tank({ co2: true }), [{ id: 'c', updatedAt: '', type: 'co2', name: 'C' }]),
      ).toEqual(['info|CO2 sans électrovanne']);
      expect(
        titles(tank({ co2: true }), [light('10:00', '18:00'), co2({})]).filter((t) =>
          t.includes('électrovanne'),
        ),
      ).toHaveLength(1);
    });
    it('ne dit rien avec une électrovanne, sans CO2 dans le bac, ou si le CO2 est programmé', () => {
      expect(titles(tank({ co2: true }), [co2({ solenoid: true })])).toEqual([]);
      expect(titles(tank({ co2: false }), [co2({})])).toEqual([]);
      expect(
        titles(tank({ co2: true }), [co2({ schedule: { on: '08:00', off: '17:00' } })]),
      ).toEqual([]);
      expect(titles(tank({ co2: true }), [])).toEqual([]);
    });
  });

  it('prévient d’un chauffage juste', () => {
    const heater = (powerW?: number): Equipment => ({
      id: 'h',
      updatedAt: '',
      type: 'heater',
      name: 'H',
      heater: { powerW },
    });
    expect(gearChecks(tank(), [heater(29)])).toEqual([
      {
        level: 'info',
        title: 'Chauffage peut-être juste',
        detail: '29 W pour 60 L : compte environ 1 W par litre dans une pièce fraîche.',
      },
    ]);
    expect(gearChecks(tank(), [heater(30)])).toEqual([]);
    expect(gearChecks(tank(), [heater(undefined)])).toEqual([]);
    expect(gearChecks(tank(), [heater(0)])).toEqual([]);
    expect(gearChecks(tank({ volumeNet: 100 }), [heater(49)])[0].detail).toContain('pour 100 L');
    expect(gearChecks(tank({ volumeGross: 0 }), [heater(10)])).toEqual([]);
  });
});
