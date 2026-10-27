import { describe, expect, it } from 'vitest';
import type { Equipment, Observation, Photo, SettingChange } from './models';
import { changeEffect, describeChange, diffSettings, effectVerdict } from './settings-history';

const light = (intensityPct: number, on = '10:00', off = '20:00'): Partial<Equipment> => ({
  type: 'light',
  light: { intensityPct, schedule: { on, off } },
});

describe('diffSettings', () => {
  it('repère une baisse d’intensité', () => {
    expect(diffSettings(light(80), light(60))).toEqual([
      { field: 'light.intensityPct', from: '80 %', to: '60 %' },
    ]);
  });
  it('note les horaires et la durée quand la plage change', () => {
    const d = diffSettings(light(80), light(80, '12:00'));
    expect(d.map((x) => x.field)).toEqual(['light.schedule', 'light.photoperiod']);
    expect(describeChange(d[1])).toBe('Durée d’éclairage : 10 h → 8 h');
  });
  it('ne note rien si les réglages sont identiques', () => {
    expect(diffSettings({ ...light(80), notes: 'a' }, { ...light(80), notes: 'b' })).toEqual([]);
  });
});

describe('changeEffect', () => {
  const change: SettingChange = {
    id: 'c',
    updatedAt: '',
    tankId: 't',
    equipmentId: 'e',
    equipmentName: 'Rampe',
    field: 'light.intensityPct',
    date: '2026-09-01T12:00:00.000Z',
  };
  const obs = (date: string, algae: number): Observation => ({
    id: date,
    updatedAt: '',
    tankId: 't',
    date,
    overall: 'watch',
    findings: Array.from({ length: algae }, () => ({
      category: 'algae' as const,
      severity: 'warn' as const,
      title: 'Algues',
      confidence: 'high' as const,
    })),
  });
  const photo = (id: string, date: string) => ({ id, tankId: 't', date }) as Photo;

  it('compare les algues avant et après, et choisit les photos', () => {
    const e = changeEffect(
      change,
      [obs('2026-08-20T00:00:00Z', 3), obs('2026-09-25T00:00:00Z', 1)],
      [photo('p1', '2026-08-25T00:00:00Z'), photo('p2', '2026-09-20T00:00:00Z')],
      new Date('2026-10-01'),
    );
    expect(e.before.level).toBe(2);
    expect(e.after.level).toBe(2);
    expect(e.photoBefore?.id).toBe('p1');
    expect(e.photoAfter?.id).toBe('p2');
    expect(effectVerdict(e).level).toBe('info');
  });
  it('utilise les notes rapides d’algues', () => {
    const manual = (date: string, algaeLevel: 0 | 1 | 2 | 3): Observation => ({
      id: date,
      updatedAt: '',
      tankId: 't',
      date,
      overall: 'watch',
      findings: [],
      manual: true,
      algaeLevel,
    });
    const e = changeEffect(
      change,
      [
        manual('2026-08-20T00:00:00Z', 3),
        manual('2026-08-28T00:00:00Z', 2),
        manual('2026-09-25T00:00:00Z', 1),
      ],
      [],
      new Date('2026-10-01'),
    );
    expect(e.before.level).toBe(2.5);
    expect(effectVerdict(e).text).toBe('Moins d’algues : niveau moyen 2,5/3 avant, 1/3 après.');
  });
  it('reste prudent si le changement est récent', () => {
    const e = changeEffect(change, [], [], new Date('2026-09-05'));
    expect(effectVerdict(e).text).toContain('Trop tôt');
  });
});
