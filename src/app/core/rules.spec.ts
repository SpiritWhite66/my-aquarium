import { describe, expect, it } from 'vitest';
import { BUILTIN_SPECIES } from './catalog';
import type { Species, Tank } from './models';
import { compatibilityIssues, idealRange, issuesIfAdded, levelOf, testAlerts } from './rules';
import { addDays, daysBetween } from './dates';
import { dueLabel, parseNumber } from './labels';

const sp = (id: string): Species => BUILTIN_SPECIES.find((s) => s.id === id)!;

const tank: Tank = {
  id: 't1',
  updatedAt: '',
  name: 'Bac test',
  type: 'planted',
  volumeGross: 60,
  startDate: '2026-01-01',
  co2: false,
  archived: false,
};

describe('catalogue', () => {
  it('contient les espèces de l’utilisateur', () => {
    for (const id of ['neritina-natalensis', 'neocaridina-davidi', 'danio-margaritatus', 'apistogramma-borellii']) {
      expect(sp(id)).toBeDefined();
    }
  });

  it('a des identifiants uniques et autant de plantes que de poissons', () => {
    const ids = BUILTIN_SPECIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const plants = BUILTIN_SPECIES.filter((s) => s.kind === 'plant').length;
    const fish = BUILTIN_SPECIES.filter((s) => s.kind === 'fish').length;
    expect(plants).toBeGreaterThanOrEqual(fish);
  });
});

describe('idealRange', () => {
  it('prend l’intersection des plages des espèces', () => {
    const r = idealRange('temp', [sp('danio-margaritatus'), sp('apistogramma-borellii')], tank)!;
    expect(r).toMatchObject({ min: 22, max: 26, conflict: false });
    expect(r.from).toHaveLength(2);
  });

  it('signale des plages qui ne se recouvrent pas', () => {
    const soft = { ...sp('paracheirodon-axelrodi'), id: 'soft', gh: { min: 1, max: 6 } };
    const hard = { ...sp('neritina-natalensis'), id: 'hard', gh: { min: 10, max: 18 } };
    const r = idealRange('gh', [soft, hard], tank)!;
    expect(r.conflict).toBe(true);
  });

  it('utilise la plage par défaut sans espèce', () => {
    expect(idealRange('no2', [], tank)).toMatchObject({ min: 0, max: 0.1 });
  });
});

describe('levelOf', () => {
  it('classe les valeurs', () => {
    const r = { min: 0, max: 0.1 };
    expect(levelOf('no2', 0.05, r)).toBe('ok');
    expect(levelOf('no2', 0.25, r)).toBe('danger'); // toxique
    expect(levelOf('ph', 7.6, { min: 6.4, max: 7.4 })).toBe('warn');
  });

  it('remonte les alertes d’un relevé', () => {
    const alerts = testAlerts({ id: 'w', updatedAt: '', tankId: 't1', date: '', values: { no2: 0.3, ph: 7 } }, [], tank);
    expect(alerts.map((a) => a.key)).toEqual(['no2']);
  });
});

describe('compatibilité', () => {
  it('prévient que les Apistogramma mangent les jeunes crevettes', () => {
    const issues = compatibilityIssues(tank, [
      { species: sp('apistogramma-borellii'), quantity: 2 },
      { species: sp('neocaridina-davidi'), quantity: 20 },
    ]);
    expect(issues.some((i) => i.title.includes('jeunes crevettes'))).toBe(true);
  });

  it('prévient qu’un herbivore menace les plantes', () => {
    const issues = issuesIfAdded(tank, [{ species: sp('rotala-rotundifolia'), quantity: 5 }], sp('metynnis-argenteus'), 5);
    expect(issues.some((i) => i.title.includes('mange les plantes'))).toBe(true);
  });

  it('signale un groupe trop petit et une plante qui exige du CO2', () => {
    const issues = compatibilityIssues(tank, [
      { species: sp('danio-margaritatus'), quantity: 4 },
      { species: sp('hemianthus-callitrichoides'), quantity: 3 },
    ]);
    expect(issues.map((i) => i.title)).toEqual(
      expect.arrayContaining(['Groupe trop petit : Rasbora galaxy', 'HC Cuba a besoin de CO2']),
    );
  });
});

describe('utilitaires', () => {
  it('gère les dates et les échéances', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetween('2026-10-25', '2026-10-27')).toBe(2);
    expect(dueLabel('2026-10-22', '2026-10-25')).toBe('en retard de 3 j');
    expect(dueLabel('2026-10-25', '2026-10-25')).toBe('aujourd’hui');
  });

  it('accepte la virgule décimale', () => {
    expect(parseNumber('6,8')).toBe(6.8);
    expect(parseNumber(' ')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
  });
});
