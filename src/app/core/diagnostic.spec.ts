import { describe, expect, it } from 'vitest';
import { BUILTIN_SPECIES } from './catalog';
import { buildDossier, diagnosticRequest } from './diagnostic';
import type { Tank } from './models';

describe('dossier de diagnostic', () => {
  const tank: Tank = {
    id: 't',
    updatedAt: '',
    name: 'Bac salon',
    type: 'planted',
    volumeGross: 60,
    startDate: '2026-03-01',
    co2: true,
    archived: false,
  };
  const base = {
    species: BUILTIN_SPECIES,
    events: [],
    tasks: [],
    logs: [],
    co2Readings: [],
    observations: [],
    diagnoses: [],
    photos: [],
    today: '2026-10-25',
    inhabitants: [
      {
        id: 'i1',
        updatedAt: '',
        tankId: 't',
        speciesId: 'rotala-rotundifolia',
        quantity: 8,
        unit: 'stem' as const,
        addedDate: '2026-09-01',
        status: 'healthy' as const,
      },
      {
        id: 'i2',
        updatedAt: '',
        tankId: 'o',
        speciesId: 'betta-splendens',
        quantity: 1,
        unit: 'individual' as const,
        addedDate: '2026-09-01',
        status: 'healthy' as const,
      },
    ],
    tests: [
      {
        id: 'w1',
        updatedAt: '',
        tankId: 't',
        date: '2026-10-20T10:00:00Z',
        values: { kh: 4, ph: 6.8, no3: 30 },
      },
      { id: 'w2', updatedAt: '', tankId: 'o', date: '2026-10-20T10:00:00Z', values: { no3: 5 } },
    ],
    equipment: [
      {
        id: 'e',
        updatedAt: '',
        tankId: 't',
        type: 'light' as const,
        name: 'Twinstar',
        light: { schedule: { on: '10:00', off: '20:30' } },
      },
    ],
  };

  it('ne contient que les données du bac', () => {
    const d = buildDossier({ ...base, tank, question: 'Algues filamenteuses' });
    expect(d.population.map((p) => p.scientificName)).toEqual(['Rotala rotundifolia']);
    expect(d.water.tests).toHaveLength(1);
    expect(d.tank.ageDays).toBe(238);
    expect(d.question).toBe('Algues filamenteuses');
  });

  it('calcule le CO2 estimé, la photopériode et les contrôles', () => {
    const d = buildDossier({ ...base, tank });
    expect(d.co2?.estimatedMgL).toBeCloseTo(19, 0);
    expect(d.equipment[0].light?.photoperiodHours).toBe(10.5);
    expect(d.equipmentChecks[0]).toContain('Éclairage long');
    expect(d.water.outOfRange.map((a) => a.param)).toContain('no3');
  });

  it('prépare la demande', () => {
    expect(diagnosticRequest('Bac salon', 'Algues')).toContain('Mon problème : Algues');
  });
});
