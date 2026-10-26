import { describe, expect, it } from 'vitest';
import type { Diagnosis } from './models';
import { measureStatus, sinceDiagnosis } from './follow-up';

const diag = {
  id: 'd', updatedAt: '', tankId: 't', date: '2026-10-26T10:00:00.000Z', summary: 'Carence', hypotheses: [{ title: 'Carence NO3/PO4', probability: 'high' }],
  actions: [{ title: 'Changement d’eau', priority: 'now', done: true }, { title: 'Engrais', priority: 'soon' }],
  followUp: { inDays: 14, measure: ['NO3', 'PO4', 'NH4 et NO2', 'pH à 11h30 et à 21h', 'photo du même angle', 'croissance des Anubias', 'NO3 vers 10 mg/L'] },
} as Diagnosis;

const data = {
  tests: [
    { id: 'a', updatedAt: '', tankId: 't', date: '2026-10-20T10:00:00Z', values: { no3: 0, po4: 0 } },
    { id: 'b', updatedAt: '', tankId: 't', date: '2026-11-02T10:00:00Z', values: { no3: 10, nh4: 0 } },
  ],
  co2Readings: [{ id: 'c', updatedAt: '', tankId: 't', date: '2026-11-01T21:00:00Z', phBefore: 7.3, phAfter: 6.4 }],
  photos: [],
  logs: [{ id: 'l', updatedAt: '', tankId: 't', type: 'fertilize' as const, label: 'Engrais — NPK 5 ml', date: '2026-10-28T10:00:00Z' }],
  settingChanges: [],
  observations: [
    { id: 'o1', updatedAt: '', tankId: 't', date: '2026-10-25T10:00:00Z', overall: 'problem' as const, findings: [], manual: true, algaeLevel: 3 as const },
    { id: 'o2', updatedAt: '', tankId: 't', date: '2026-11-02T10:00:00Z', overall: 'watch' as const, findings: [], manual: true, algaeLevel: 1 as const },
  ],
};

describe('suivi de diagnostic', () => {
  it('vérifie les mesures demandées depuis le diagnostic', () => {
    const s = measureStatus(diag, data);
    expect(s.map((m) => m.done)).toEqual([true, false, false, true, false, undefined, true]);
    expect(s[0].detail).toBe('10');
    expect(s[3].detail).toBe('pH 7,3 → 6,4');
  });
  it('résume ce qui a changé', () => {
    const r = sinceDiagnosis(diag, data, '2026-11-09');
    expect(r.daysSince).toBe(14);
    expect(r.followUpPlannedFor).toBe('2026-11-09');
    expect(r.fertilizerDosesSince).toBe(1);
    expect(r.algaeLevel).toEqual({ before: 3, since: 1, notesSince: 1 });
    expect(r.waterTestsSince).toHaveLength(1);
  });
});
