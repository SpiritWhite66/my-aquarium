import { describe, expect, it } from 'vitest';
import type { Inhabitant, InhabitantEvent, MaintenanceLog, Observation, Species } from './models';
import { maintenanceTimeline } from './maintenance-view';
import { groupSettingChanges } from './settings-history';
import type { SettingChange } from './models';

const log = (id: string, date: string, over: Partial<MaintenanceLog> = {}): MaintenanceLog => ({
  id,
  updatedAt: '',
  tankId: 't',
  type: 'water_change',
  label: 'Changement d’eau',
  date,
  ...over,
});
const sp = (id: string, kind: Species['kind'], name: string): Species => ({
  id,
  updatedAt: '',
  kind,
  scientificName: name,
  commonNames: [name],
  source: 'builtin',
});
const inh = (id: string, speciesId: string): Inhabitant => ({
  id,
  updatedAt: '',
  tankId: 't',
  speciesId,
  quantity: 1,
  unit: 'individual',
  addedDate: '2026-01-01',
  status: 'healthy',
});
const ev = (
  id: string,
  inhabitantId: string,
  date: string,
  over: Partial<InhabitantEvent> = {},
): InhabitantEvent => ({
  id,
  updatedAt: '',
  inhabitantId,
  tankId: 't',
  date,
  type: 'death',
  ...over,
});

describe('maintenanceTimeline', () => {
  const species = new Map([
    ['neon', sp('neon', 'fish', 'Néon')],
    ['anubias', sp('anubias', 'plant', 'Anubias')],
  ]);
  const inhabitants = [inh('i1', 'neon'), inh('i2', 'anubias')];

  it('mélange entretien et événements, du plus récent au plus ancien', () => {
    const out = maintenanceTimeline(
      't',
      [log('l1', '2026-10-01T10:00:00Z')],
      [
        ev('e1', 'i1', '2026-10-03T10:00:00Z'),
        ev('e2', 'i2', '2026-10-02T10:00:00Z', { type: 'trim' }),
      ],
      inhabitants,
      species,
    );
    expect(out.map((x) => x.id)).toEqual(['e1', 'e2', 'l1']);
  });

  it('titre des événements : action, espèce et variation', () => {
    const out = maintenanceTimeline(
      't',
      [],
      [
        ev('a', 'i1', '2026-10-03T00:00:00Z', { quantityDelta: -2, note: 'n' }),
        ev('b', 'i1', '2026-10-02T00:00:00Z', { type: 'birth', quantityDelta: 3 }),
        ev('c', 'i1', '2026-10-01T00:00:00Z', { type: 'note' }),
      ],
      inhabitants,
      species,
    );
    expect(out.map((x) => x.title)).toEqual([
      'Décès — Néon (-2)',
      'Naissance — Néon (+3)',
      'Note — Néon',
    ]);
    expect(out[0].note).toBe('n');
  });

  it('repère ce qui concerne les plantes', () => {
    const out = maintenanceTimeline(
      't',
      [
        log('l1', '2026-10-01T00:00:00Z', { type: 'plant_trim', label: 'Taille' }),
        log('l2', '2026-10-02T00:00:00Z'),
      ],
      [
        ev('e1', 'i2', '2026-10-03T00:00:00Z', { type: 'trim' }),
        ev('e2', 'i1', '2026-10-04T00:00:00Z'),
      ],
      inhabitants,
      species,
    );
    expect(Object.fromEntries(out.map((x) => [x.id, x.plant]))).toEqual({
      e2: false,
      e1: true,
      l2: false,
      l1: true,
    });
  });

  it('espèce inconnue : libellé neutre, pas une plante', () => {
    const out = maintenanceTimeline(
      't',
      [],
      [ev('e', 'fantôme', '2026-10-01T00:00:00Z')],
      inhabitants,
      species,
    );
    expect(out[0]).toMatchObject({ title: 'Décès — Espèce inconnue', plant: false });
  });

  it('ignore les autres bacs', () => {
    const out = maintenanceTimeline(
      't',
      [log('l1', '2026-10-01T00:00:00Z', { tankId: 'x' })],
      [{ ...ev('e', 'i1', '2026-10-01T00:00:00Z'), tankId: 'x' }],
      inhabitants,
      species,
    );
    expect(out).toEqual([]);
  });

  it('garde les 30 plus récents', () => {
    const logs = Array.from({ length: 35 }, (_, i) =>
      log(`l${i}`, new Date(Date.UTC(2026, 8, 1 + i)).toISOString()),
    );
    const out = maintenanceTimeline('t', logs, [], [], species);
    expect(out).toHaveLength(30);
    expect(out[0].id).toBe('l34');
    expect(out.at(-1)!.id).toBe('l5');
  });
});

describe('groupSettingChanges', () => {
  const change = (
    id: string,
    equipmentId: string,
    date: string,
    field: SettingChange['field'],
    over: Partial<SettingChange> = {},
  ): SettingChange => ({
    id,
    updatedAt: '',
    tankId: 't',
    equipmentId,
    equipmentName: 'Rampe',
    date,
    field,
    from: '50',
    to: '60',
    ...over,
  });
  const NOW = new Date('2026-10-31T12:00:00Z');
  const noObs: Observation[] = [];

  it('regroupe les réglages enregistrés ensemble (même matériel, même date)', () => {
    const out = groupSettingChanges(
      [
        change('1', 'e1', '2026-10-01T10:00:00Z', 'light.intensityPct'),
        change('2', 'e1', '2026-10-01T10:00:00Z', 'light.schedule'),
        change('3', 'e2', '2026-10-01T10:00:00Z', 'heater.setpointC'),
      ],
      't',
      noObs,
      [],
      NOW,
    );
    expect(out).toHaveLength(2);
    expect(out.find((g) => g.equipmentId === 'e1')!.changes.map((c) => c.id)).toEqual(['1', '2']);
    expect(out.find((g) => g.equipmentId === 'e1')!.key).toBe('e12026-10-01T10:00:00Z');
  });

  it('du plus récent au plus ancien, sans les autres bacs', () => {
    const out = groupSettingChanges(
      [
        change('1', 'e1', '2026-10-01T10:00:00Z', 'light.intensityPct'),
        change('2', 'e1', '2026-10-10T10:00:00Z', 'light.intensityPct'),
        change('3', 'e1', '2026-10-20T10:00:00Z', 'light.intensityPct', { tankId: 'x' }),
      ],
      't',
      noObs,
      [],
      NOW,
    );
    expect(out.map((g) => g.changes[0].id)).toEqual(['2', '1']);
  });

  it('l’« après » s’arrête au changement suivant du même réglage', () => {
    const obs = (id: string, date: string, level: 0 | 1 | 2 | 3): Observation => ({
      id,
      updatedAt: '',
      tankId: 't',
      date,
      overall: 'good',
      findings: [],
      algaeLevel: level,
      manual: true,
    });
    const observations = [obs('a', '2026-10-05T00:00:00Z', 1), obs('b', '2026-10-15T00:00:00Z', 3)];
    const out = groupSettingChanges(
      [
        change('1', 'e1', '2026-10-01T10:00:00Z', 'light.intensityPct'),
        change('2', 'e1', '2026-10-10T10:00:00Z', 'light.intensityPct'),
      ],
      't',
      observations,
      [],
      NOW,
    );
    const first = out.find((g) => g.changes[0].id === '1')!;
    const second = out.find((g) => g.changes[0].id === '2')!;
    expect(first.effect.after.checks).toBe(1); // le 5 seulement, pas le 15
    expect(second.effect.after.checks).toBe(1); // le 15
  });

  it('un autre réglage du même matériel ne borne pas la période', () => {
    const obs = {
      id: 'a',
      updatedAt: '',
      tankId: 't',
      date: '2026-10-15T00:00:00Z',
      overall: 'good',
      findings: [],
      algaeLevel: 2,
      manual: true,
    } as Observation;
    const out = groupSettingChanges(
      [
        change('1', 'e1', '2026-10-01T10:00:00Z', 'light.intensityPct'),
        change('2', 'e1', '2026-10-10T10:00:00Z', 'light.schedule'),
      ],
      't',
      [obs],
      [],
      NOW,
    );
    expect(out.find((g) => g.changes[0].id === '1')!.effect.after.checks).toBe(1);
  });

  it('fournit un verdict', () => {
    const [g] = groupSettingChanges(
      [change('1', 'e1', '2026-10-30T10:00:00Z', 'light.intensityPct')],
      't',
      noObs,
      [],
      NOW,
    );
    expect(g.verdict.text.length).toBeGreaterThan(0);
  });
});
