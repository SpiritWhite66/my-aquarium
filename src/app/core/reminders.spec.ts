import { describe, expect, it } from 'vitest';
import type { Diagnosis, MaintenanceTask, Tank } from './models';
import { DEFAULT_PREFS, digestFor, digestsAhead, shouldNotify } from './reminders';

const tank = (id: string, name: string) => ({ id, name, archived: false }) as Tank;
const task = (label: string, nextDue: string, tankId = 'a') => ({ id: label, tankId, label, nextDue, active: true, everyDays: 7 }) as MaintenanceTask;
const data = {
  tanks: [tank('a', 'Salon'), tank('b', 'Nano')],
  tasks: [task('Changement d’eau', '2026-10-26'), task('Engrais', '2026-10-28', 'b')],
  diagnoses: [{ id: 'd', tankId: 'a', date: '2026-10-20T10:00:00Z', followUp: { inDays: 14 } } as Diagnosis],
};

describe('rappels', () => {
  it('liste les tâches dues avec le nom du bac', () => {
    expect(digestFor('2026-10-26', data, DEFAULT_PREFS)).toEqual({ title: 'Une chose à faire pour tes bacs', body: 'Changement d’eau (Salon)' });
  });
  it('ajoute le suivi de diagnostic le jour venu', () => {
    const d = digestFor('2026-11-03', data, DEFAULT_PREFS)!;
    expect(d.title).toBe('3 choses à faire pour tes bacs');
    expect(d.body).toContain('Suivi du diagnostic : Salon');
  });
  it('prépare les jours suivants', () => {
    expect(Object.keys(digestsAhead('2026-10-25', data, DEFAULT_PREFS, 4))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });
  it('n’affiche qu’une fois par jour, après l’heure choisie', () => {
    const prefs = { ...DEFAULT_PREFS, enabled: true, digests: { '2026-10-26': { title: 't', body: 'b' } } };
    expect(shouldNotify(prefs, new Date(2026, 9, 26, 8, 0), '2026-10-26')).toBeUndefined();
    expect(shouldNotify(prefs, new Date(2026, 9, 26, 9, 30), '2026-10-26')?.title).toBe('t');
    expect(shouldNotify({ ...prefs, lastShown: '2026-10-26' }, new Date(2026, 9, 26, 9, 30), '2026-10-26')).toBeUndefined();
  });
});
