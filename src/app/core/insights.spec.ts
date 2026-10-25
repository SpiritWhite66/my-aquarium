import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, Tank, WaterTest } from './models';
import { afterWaterChange, cyclingPhase, percentFromLabel, tasksToIcs, trendOf } from './insights';

const DAY = 86_400_000;
const NOW = new Date('2026-10-25T12:00:00Z').getTime();
const test = (daysAgo: number, values: WaterTest['values']): WaterTest => ({
  id: String(daysAgo), updatedAt: '', tankId: 't', date: new Date(NOW - daysAgo * DAY).toISOString(), values,
});

describe('changement d’eau', () => {
  it('lit le pourcentage dans le libellé', () => {
    expect(percentFromLabel('Changement d’eau 40 %')).toBe(40);
    expect(percentFromLabel('Changement d’eau')).toBe(30);
  });
  it('estime les nitrates après le changement', () => {
    expect(afterWaterChange(31, 0.4)).toBe(18.6);
    expect(afterWaterChange(30, 0.5, 10)).toBe(20);
  });
});

describe('tendance', () => {
  it('détecte une hausse des nitrates et estime le dépassement', () => {
    const tests = [test(21, { no3: 10 }), test(14, { no3: 14 }), test(7, { no3: 18 }), test(0, { no3: 22 })];
    const t = trendOf(tests, 'no3', { min: 5, max: 25 }, 60, NOW)!;
    expect(t.perWeek).toBeCloseTo(4, 1);
    expect(t.limit).toBe('max');
    expect(t.daysToLimit).toBe(6);
  });
  it('ignore une valeur stable ou trop peu de mesures', () => {
    expect(trendOf([test(14, { ph: 6.8 }), test(7, { ph: 6.9 }), test(0, { ph: 6.8 })], 'ph', { min: 6.5, max: 7.5 }, 60, NOW)).toBeUndefined();
    expect(trendOf([test(7, { no3: 5 }), test(0, { no3: 25 })], 'no3', { min: 5, max: 25 }, 60, NOW)).toBeUndefined();
  });
});

describe('cyclage', () => {
  it('suit les phases', () => {
    expect(cyclingPhase([])).toBe('no_data');
    expect(cyclingPhase([test(10, { nh4: 2, no2: 0 })])).toBe('ammonia');
    expect(cyclingPhase([test(10, { nh4: 2 }), test(5, { nh4: 0.5, no2: 1 })])).toBe('nitrite');
    expect(cyclingPhase([test(5, { nh4: 0, no2: 0.5 }), test(2, { nh4: 0, no2: 0, no3: 10 })])).toBe('waiting');
    expect(cyclingPhase([test(4, { nh4: 0, no2: 0, no3: 10 }), test(1, { nh4: 0, no2: 0, no3: 15 })])).toBe('done');
  });
});

describe('agenda', () => {
  it('produit un calendrier avec répétition et alarme', () => {
    const tank = { id: 't', name: 'Bac salon' } as Tank;
    const task: MaintenanceTask = { id: 'x', updatedAt: '', tankId: 't', type: 'water_change', label: 'Changement d’eau 30 %', everyDays: 7, nextDue: '2026-10-27', active: true };
    const ics = tasksToIcs([task], [tank], new Date(NOW));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261027');
    expect(ics).toContain('RRULE:FREQ=DAILY;INTERVAL=7');
    expect(ics).toContain('SUMMARY:Changement d’eau 30 % — Bac salon');
    expect(ics).toContain('TRIGGER:PT9H');
    expect(ics.split('BEGIN:VEVENT')).toHaveLength(2);
  });
});
