// Cas limites des règles métier. Les espèces sont fabriquées ici : les tests ne dépendent pas du catalogue.
import { describe, expect, it } from 'vitest';
import type { Inhabitant, Species, Tank } from './models';
import { PARAMS, PARAM_BY_KEY, compatibilityIssues, idealRange, isAlive, issuesIfAdded, levelOf, measuredParams, testAlerts, worst } from './rules';

const sp = (id: string, o: Record<string, unknown> = {}): Species =>
  ({ id, scientificName: `Sci ${id}`, commonNames: [id.toUpperCase()], kind: 'fish', source: 'builtin', ...o }) as unknown as Species;
const tank = (o: Partial<Tank> = {}): Tank => ({ id: 't', updatedAt: '', name: 'Bac', type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false, ...o });
const m = (species: Species, quantity = 5) => ({ species, quantity });

describe('measuredParams', () => {
  it('donne les paramètres principaux dans l’ordre', () => {
    expect(measuredParams([])).toEqual(['temp', 'ph', 'gh', 'kh', 'no2', 'no3', 'nh4', 'po4']);
  });

  it('ajoute les secondaires dès qu’un relevé les contient, pas avant', () => {
    expect(measuredParams([{ values: { fe: 0.1 } }, { values: { ph: 7, mg: 10 } }])).toEqual(['temp', 'ph', 'gh', 'kh', 'no2', 'no3', 'nh4', 'po4', 'fe', 'mg']);
    expect(measuredParams([{ values: { fe: undefined } }])).toHaveLength(8);
    expect(measuredParams([{ values: { conductivity: 0 } }])).toContain('conductivity');
  });
});

describe('plages par défaut', () => {
  it('chaque paramètre est décrit avec son unité et son nom court', () => {
    expect(PARAMS.map((p) => p.key)).toHaveLength(13);
    expect(PARAM_BY_KEY.no3).toMatchObject({ short: 'NO3', unit: 'mg/L' });
    expect(PARAM_BY_KEY.no2.toxic).toBe(true);
    expect(PARAM_BY_KEY.nh4.toxic).toBe(true);
    expect(PARAM_BY_KEY.no3.toxic).toBeUndefined();
  });

  it.each([
    ['no3', 'planted', { min: 5, max: 25 }],
    ['no3', 'community', { min: 0, max: 25 }],
    ['po4', 'planted', { min: 0.1, max: 1.5 }],
    ['po4', 'community', { min: 0, max: 1.5 }],
    ['fe', 'planted', { min: 0.05, max: 0.5 }],
    ['fe', 'community', { min: 0, max: 0.5 }],
    ['k', 'planted', { min: 5, max: 30 }],
    ['mg', 'planted', { min: 5, max: 20 }],
    ['co2', 'planted', { min: 0, max: 30 }],
    ['no2', 'planted', { min: 0, max: 0.1 }],
    ['nh4', 'community', { min: 0, max: 0.2 }],
  ] as const)('%s dans un bac %s', (key, type, expected) => {
    expect(idealRange(key, [], tank({ type }))).toEqual({ ...expected, from: [], conflict: false });
  });

  it('sans bac, la plage de base s’applique', () => {
    expect(idealRange('no3', [])).toMatchObject({ min: 0, max: 25 });
  });

  it('sans bac, les repères des bacs plantés ne s’appliquent pas', () => {
    expect(idealRange('po4', [])).toMatchObject({ min: 0, max: 1.5 });
    expect(idealRange('fe', [])).toMatchObject({ min: 0, max: 0.5 });
    expect(idealRange('k', [])).toBeUndefined();
  });

  it('k et mg n’ont de repère que dans un bac planté', () => {
    expect(idealRange('k', [], tank({ type: 'community' }))).toBeUndefined();
    expect(idealRange('mg', [])).toBeUndefined();
    expect(idealRange('conductivity', [], tank())).toBeUndefined();
  });

  it('température, pH, GH et KH reprennent la plage par défaut sans espèce renseignée', () => {
    expect(idealRange('temp', [], tank())).toEqual({ min: 22, max: 26, from: [], conflict: false });
    expect(idealRange('ph', [sp('a')], tank())).toEqual({ min: 6, max: 7.5, from: [], conflict: false });
    expect(idealRange('gh', [], tank())).toMatchObject({ min: 4, max: 12 });
    expect(idealRange('kh', [], tank())).toMatchObject({ min: 2, max: 8 });
  });

  it('une espèce sans plage pour ce paramètre est ignorée', () => {
    const a = sp('a', { temp: { min: 20, max: 24 } });
    const b = sp('b');
    const r = idealRange('temp', [a, b], tank())!;
    expect(r.from.map((s) => s.id)).toEqual(['a']);
    expect(r).toMatchObject({ min: 20, max: 24 });
  });
});

describe('plage commune des espèces', () => {
  it('prend la borne la plus haute des minimums et la plus basse des maximums', () => {
    const r = idealRange('ph', [sp('a', { ph: { min: 6, max: 8 } }), sp('b', { ph: { min: 6.5, max: 7.5 } }), sp('c', { ph: { min: 5, max: 7.8 } })], tank())!;
    expect(r).toMatchObject({ min: 6.5, max: 7.5, conflict: false });
    expect(r.from).toHaveLength(3);
  });

  it('des plages qui se touchent en un point restent compatibles', () => {
    const r = idealRange('temp', [sp('a', { temp: { min: 20, max: 24 } }), sp('b', { temp: { min: 24, max: 28 } })], tank())!;
    expect(r).toMatchObject({ min: 24, max: 24, conflict: false });
  });

  it('des plages disjointes donnent la zone entre les deux, en conflit', () => {
    const r = idealRange('temp', [sp('a', { temp: { min: 20, max: 22 } }), sp('b', { temp: { min: 25, max: 28 } })], tank())!;
    expect(r).toMatchObject({ min: 22, max: 25, conflict: true });
    expect(r.from.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('levelOf', () => {
  const r = { min: 6, max: 7 };
  it('sans plage, tout est normal', () => expect(levelOf('ph', 99)).toBe('ok'));

  it('les bornes sont incluses', () => {
    expect(levelOf('ph', 6, r)).toBe('ok');
    expect(levelOf('ph', 7, r)).toBe('ok');
    expect(levelOf('ph', 6.5, r)).toBe('ok');
  });

  it('juste au-delà, à surveiller ; au-delà de la moitié de la plage, danger', () => {
    expect(levelOf('ph', 7.01, r)).toBe('warn');
    expect(levelOf('ph', 7.5, r)).toBe('warn');
    expect(levelOf('ph', 7.51, r)).toBe('danger');
    expect(levelOf('ph', 5.99, r)).toBe('warn');
    expect(levelOf('ph', 5.5, r)).toBe('warn');
    expect(levelOf('ph', 5.49, r)).toBe('danger');
  });

  it('une plage étroite est élargie à 0,1 pour juger l’écart', () => {
    const narrow = { min: 5, max: 5 };
    expect(levelOf('ph', 5.05, narrow)).toBe('warn');
    expect(levelOf('ph', 5.06, narrow)).toBe('danger');
    expect(levelOf('ph', 4.94, narrow)).toBe('danger');
    expect(levelOf('ph', 4.95, narrow)).toBe('warn');
  });

  it('un toxique au-dessus du maximum est toujours un danger, même de très peu', () => {
    expect(levelOf('no2', 0.1, { min: 0, max: 0.1 })).toBe('ok');
    expect(levelOf('no2', 0.11, { min: 0, max: 0.1 })).toBe('danger');
    expect(levelOf('nh4', 0.21, { min: 0, max: 0.2 })).toBe('danger');
    expect(levelOf('no3', 26, { min: 0, max: 25 })).toBe('warn');
  });

  it('un toxique en dessous du minimum suit la règle ordinaire', () => {
    expect(levelOf('nh4', 0.05, { min: 0.1, max: 0.2 })).toBe('warn');
    expect(levelOf('nh4', 0.04, { min: 0.1, max: 0.2 })).toBe('danger');
  });
});

describe('worst', () => {
  it('retient le pire niveau', () => {
    expect(worst([])).toBe('ok');
    expect(worst(['ok', 'ok'])).toBe('ok');
    expect(worst(['ok', 'warn'])).toBe('warn');
    expect(worst(['warn', 'danger', 'ok'])).toBe('danger');
    expect(worst(['danger'])).toBe('danger');
  });
});

describe('testAlerts', () => {
  const t = tank({ type: 'community' });
  const test = (values: Record<string, number | undefined>) => ({ id: 'w', updatedAt: '', tankId: 't', date: '', values }) as never;

  it('sans relevé, rien', () => expect(testAlerts(undefined, [], t)).toEqual([]));

  it('ne remonte que les valeurs hors plage, avec le sens et la plage', () => {
    const alerts = testAlerts(test({ ph: 7, no3: 40, temp: 20, kh: 5 }), [], t);
    expect(alerts).toEqual([
      { key: 'no3', value: 40, range: { min: 0, max: 25, from: [], conflict: false }, level: 'danger', direction: 'high' },
      { key: 'temp', value: 20, range: { min: 22, max: 26, from: [], conflict: false }, level: 'warn', direction: 'low' },
    ]);
  });

  it('ignore les valeurs absentes et les paramètres sans plage', () => {
    expect(testAlerts(test({ ph: undefined, conductivity: 9999 }), [], t)).toEqual([]);
  });

  it('place les dangers avant les alertes simples, quel que soit l’ordre du relevé', () => {
    const a = testAlerts(test({ temp: 27, no2: 1, ph: 7.6 }), [], t);
    expect(a.map((x) => x.key)).toEqual(['no2', 'temp', 'ph']);
    expect(a.map((x) => x.level)).toEqual(['danger', 'warn', 'warn']);
  });

  it('utilise les plages des espèces', () => {
    const alerts = testAlerts(test({ temp: 24 }), [sp('a', { temp: { min: 26, max: 30 } })], t);
    expect(alerts[0]).toMatchObject({ key: 'temp', direction: 'low' });
  });
});

describe('isAlive', () => {
  it('un habitant mort ou retiré ne compte plus', () => {
    const i = (status: Inhabitant['status']) => ({ status }) as Inhabitant;
    expect(isAlive(i('healthy'))).toBe(true);
    expect(isAlive(i('sick'))).toBe(true);
    expect(isAlive(i('quarantine'))).toBe(true);
    expect(isAlive(i('dead'))).toBe(false);
    expect(isAlive(i('removed'))).toBe(false);
  });
});

describe('compatibilité : cas par cas', () => {
  const plant = (id: string) => sp(id, { kind: 'plant' });
  const shrimp = (id: string) => sp(id, { kind: 'shrimp' });

  it('un bac sans problème ne remonte rien', () => {
    expect(compatibilityIssues(tank(), [m(sp('a', { fauna: { minGroup: 6 } }), 6), m(plant('p'))])).toEqual([]);
    expect(compatibilityIssues(tank(), [])).toEqual([]);
  });

  it('température incompatible : espèces nommées avec « et »', () => {
    const a = sp('a', { temp: { min: 20, max: 22 } });
    const b = sp('b', { temp: { min: 25, max: 28 } });
    expect(compatibilityIssues(tank(), [m(a), m(b)])).toEqual([
      { level: 'warn', title: 'Temp. incompatibles', detail: 'Les plages de A et B ne se recouvrent pas.', speciesIds: ['a', 'b'] },
    ]);
  });

  it('plusieurs conflits sont tous signalés, trois espèces se listent avec une virgule', () => {
    const a = sp('a', { ph: { min: 5, max: 6 }, kh: { min: 1, max: 2 } });
    const b = sp('b', { ph: { min: 7, max: 8 }, kh: { min: 5, max: 6 } });
    const c = sp('c', { ph: { min: 7.5, max: 9 } });
    const issues = compatibilityIssues(tank(), [m(a), m(b), m(c)]);
    expect(issues.map((i) => i.title)).toEqual(['pH incompatibles', 'KH incompatibles']);
    expect(issues[0].detail).toBe('Les plages de A, B et C ne se recouvrent pas.');
    expect(issues[1].detail).toBe('Les plages de A et B ne se recouvrent pas.');
  });

  it('une espèce sans nom commun est désignée par son nom scientifique', () => {
    const eater = sp('e', { fauna: { eatsPlants: true }, commonNames: [] });
    const [i] = compatibilityIssues(tank(), [m(eater), m(plant('p'))]);
    expect(i.title).toBe('Sci e mange les plantes');
  });

  it('un mangeur de plantes menace une plante (singulier) ou plusieurs (pluriel)', () => {
    const eater = sp('e', { fauna: { eatsPlants: true } });
    expect(compatibilityIssues(tank(), [m(eater), m(plant('p'))])).toEqual([
      { level: 'warn', title: 'E mange les plantes', detail: 'P est menacée.', speciesIds: ['e', 'p'] },
    ]);
    const [two] = compatibilityIssues(tank(), [m(eater), m(plant('p')), m(plant('q'))]);
    expect(two.detail).toBe('P et Q sont menacées.');
    expect(two.speciesIds).toEqual(['e', 'p', 'q']);
    expect(compatibilityIssues(tank(), [m(eater)])).toEqual([]);
  });

  it('un chasseur de crevettes les menace ; un mangeur d’alevins est regroupé avec ses semblables', () => {
    const hunter = sp('h', { fauna: { predation: ['shrimp'] } });
    expect(compatibilityIssues(tank(), [m(hunter), m(shrimp('s'))])).toEqual([
      { level: 'warn', title: 'H chasse les crevettes', detail: 'S risquent d\'être mangées.', speciesIds: ['h', 's'] },
    ]);
    expect(compatibilityIssues(tank(), [m(hunter)])).toEqual([]);

    const fry1 = sp('f1', { fauna: { predation: ['shrimp_fry'] } });
    const fry2 = sp('f2', { fauna: { predation: ['shrimp_fry'] } });
    const issues = compatibilityIssues(tank(), [m(fry1), m(fry2), m(shrimp('s'))]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ title: 'F1 et F2 mangent les jeunes crevettes', speciesIds: ['f1', 'f2', 's'], level: 'warn' });
    expect(issues[0].detail).toContain('mousses');
    const single = compatibilityIssues(tank(), [m(fry1), m(shrimp('s'))]);
    expect(single[0].title).toBe('F1 mange les jeunes crevettes');
    expect(compatibilityIssues(tank(), [m(fry1)])).toEqual([]);
  });

  it('un chasseur de crevettes adultes n’est pas aussi compté comme mangeur d’alevins', () => {
    const both = sp('b', { fauna: { predation: ['shrimp', 'shrimp_fry'] } });
    const issues = compatibilityIssues(tank(), [m(both), m(shrimp('s'))]);
    expect(issues.map((i) => i.title)).toEqual(['B chasse les crevettes']);
  });

  it('un mangeur d’escargots menace les escargots', () => {
    const eater = sp('e', { fauna: { predation: ['snails'] } });
    const snail = sp('n', { kind: 'snail' });
    expect(compatibilityIssues(tank(), [m(eater), m(snail)])).toEqual([
      { level: 'warn', title: 'E mange les escargots', detail: 'N sont menacés.', speciesIds: ['e', 'n'] },
    ]);
    expect(compatibilityIssues(tank(), [m(eater)])).toEqual([]);
  });

  it('un groupe trop petit est signalé avec les bons accords', () => {
    const group = sp('g', { fauna: { minGroup: 6 } });
    expect(compatibilityIssues(tank(), [m(group, 1)])).toEqual([
      { level: 'warn', title: 'Groupe trop petit : G', detail: '1 individu, au moins 6 conseillés.', speciesIds: ['g'] },
    ]);
    expect(compatibilityIssues(tank(), [m(group, 5)])[0].detail).toBe('5 individus, au moins 6 conseillés.');
    expect(compatibilityIssues(tank(), [m(group, 6)])).toEqual([]);
    expect(compatibilityIssues(tank(), [m(sp('x', { fauna: { minGroup: 1 } }), 0)])).toEqual([]);
  });

  it('un bac trop petit est signalé selon le volume net quand il existe', () => {
    const big = sp('b', { fauna: { minTankLiters: 100 } });
    expect(compatibilityIssues(tank({ volumeGross: 60 }), [m(big)])).toEqual([
      { level: 'warn', title: 'Bac trop petit pour B', detail: '60 L, au moins 100 L conseillés.', speciesIds: ['b'] },
    ]);
    expect(compatibilityIssues(tank({ volumeGross: 120, volumeNet: 90 }), [m(big)])[0].detail).toBe('90 L, au moins 100 L conseillés.');
    expect(compatibilityIssues(tank({ volumeGross: 100 }), [m(big)])).toEqual([]);
    expect(compatibilityIssues(tank({ volumeGross: 80, volumeNet: 100 }), [m(big)])).toEqual([]);
  });

  it('une plante qui exige du CO2 le signale quand le bac n’en a pas', () => {
    const needy = sp('n', { kind: 'plant', flora: { co2: 'required' } });
    expect(compatibilityIssues(tank({ co2: false }), [m(needy)])).toEqual([
      { level: 'warn', title: 'N a besoin de CO2', detail: 'Le bac n’a pas d’injection de CO2.', speciesIds: ['n'] },
    ]);
    expect(compatibilityIssues(tank({ co2: true }), [m(needy)])).toEqual([]);
    expect(compatibilityIssues(tank(), [m(sp('o', { kind: 'plant', flora: { co2: 'optional' } }))])).toEqual([]);
  });

  it('des animaux dans un bac en cyclage sont un danger', () => {
    const cyc = tank({ cycling: true });
    expect(compatibilityIssues(cyc, [m(sp('a'))])).toEqual([
      { level: 'danger', title: 'Animaux dans un bac en cyclage', detail: 'A est exposé aux pics d’ammonium et de nitrites. Attends la fin du cyclage ou surveille de très près.', speciesIds: ['a'] },
    ]);
    const two = compatibilityIssues(cyc, [m(sp('a')), m(sp('b')), m(plant('p'))])[0];
    expect(two.detail.startsWith('A et B sont exposés')).toBe(true);
    expect(two.speciesIds).toEqual(['a', 'b']);
    expect(compatibilityIssues(cyc, [m(plant('p'))])).toEqual([]);
    expect(compatibilityIssues(tank({ cycling: false }), [m(sp('a'))])).toEqual([]);
  });
});

describe('issuesIfAdded', () => {
  const group = sp('g', { fauna: { minGroup: 6 } });
  const eater = sp('e', { fauna: { eatsPlants: true } });
  const plant = sp('p', { kind: 'plant' });

  it('ne retient que les problèmes que l’ajout provoque et qui concernent l’espèce ajoutée', () => {
    const issues = issuesIfAdded(tank(), [m(plant)], eater);
    expect(issues.map((i) => i.title)).toEqual(['E mange les plantes']);
  });

  it('ignore ce qui existait déjà avant l’ajout', () => {
    const other = sp('o', { fauna: { minGroup: 6 } });
    const issues = issuesIfAdded(tank(), [m(other, 2)], sp('z'));
    expect(issues).toEqual([]);
  });

  it('un problème déjà présent avant l’ajout, identique après, n’est pas attribué à l’ajout', () => {
    const issues = issuesIfAdded(tank(), [m(eater), m(plant)], eater, 1);
    expect(issues).toEqual([]);
  });

  it('ajouter à une espèce déjà présente augmente sa quantité plutôt que de la dupliquer', () => {
    expect(issuesIfAdded(tank(), [m(group, 2)], group, 4)).toEqual([]);
    expect(issuesIfAdded(tank(), [m(group, 2)], group, 1).map((i) => i.detail)).toEqual(['3 individus, au moins 6 conseillés.']);
    expect(issuesIfAdded(tank(), [], group, 2).map((i) => i.title)).toEqual(['Groupe trop petit : G']);
  });

  it('une nouvelle espèce est ajoutée avec la quantité demandée (1 par défaut)', () => {
    expect(issuesIfAdded(tank(), [], group).map((i) => i.detail)).toEqual(['1 individu, au moins 6 conseillés.']);
    expect(issuesIfAdded(tank(), [], group, 3).map((i) => i.detail)).toEqual(['3 individus, au moins 6 conseillés.']);
    expect(issuesIfAdded(tank(), [], group, 6)).toEqual([]);
  });

  it('un problème qui change de texte compte comme nouveau', () => {
    const eater2 = sp('e2', { fauna: { eatsPlants: true } });
    const p2 = sp('p2', { kind: 'plant' });
    const issues = issuesIfAdded(tank(), [m(eater2), m(plant)], p2);
    expect(issues.map((i) => i.detail)).toEqual(['P et P2 sont menacées.']);
  });
});
