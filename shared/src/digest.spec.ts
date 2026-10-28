import { describe, expect, it } from 'vitest';
import { addDaysIso, buildDigest, dayInZone, followUpsDueOn } from './digest.js';

const utcDay = (iso: string) => iso.slice(0, 10);
const tanks = [
  { id: 'a', name: 'Salon', archived: false },
  { id: 'b', name: 'Nano', archived: false },
  { id: 'z', name: 'Archivé', archived: true },
];
const task = (id: string, tankId: string, nextDue: string, active = true) => ({
  id,
  tankId,
  label: `Tâche ${id}`,
  nextDue,
  active,
});

describe('addDaysIso', () => {
  it('ajoute des jours en changeant de mois et d’année', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2026-03-29T10:00:00Z', 0)).toBe('2026-03-29');
  });
});

describe('dayInZone', () => {
  it('donne le jour local d’un horodatage', () => {
    expect(dayInZone('2026-10-29T23:30:00Z', 'Europe/Paris')).toBe('2026-10-30');
    expect(dayInZone('2026-10-29T23:30:00Z', 'UTC')).toBe('2026-10-29');
  });

  it('laisse une date seule telle quelle et tolère un texte invalide', () => {
    expect(dayInZone('2026-10-29', 'Asia/Tokyo')).toBe('2026-10-29');
    expect(dayInZone('2026-10-29Tpas-une-heure', 'UTC')).toBe('2026-10-29');
  });
});

describe('followUpsDueOn', () => {
  it('ne garde que le dernier diagnostic de chaque bac, une fois le délai écoulé', () => {
    const diagnoses = [
      { tankId: 'a', date: '2026-10-01T10:00:00Z', followUp: { inDays: 3 } },
      { tankId: 'a', date: '2026-10-20T10:00:00Z', followUp: { inDays: 7 } },
      { tankId: 'b', date: '2026-10-10T10:00:00Z' },
    ];
    expect(followUpsDueOn(diagnoses, '2026-10-26', utcDay)).toEqual([]);
    expect(followUpsDueOn(diagnoses, '2026-10-27', utcDay)).toEqual([diagnoses[1]]);
  });
});

describe('buildDigest', () => {
  const prefs = { tasks: true, followUps: true };

  it('ne dit rien quand rien n’est dû', () => {
    expect(
      buildDigest('2026-10-29', { tasks: [], diagnoses: [], tanks }, prefs, utcDay),
    ).toBeUndefined();
  });

  it('liste les tâches dues des bacs actifs, avec le nom du bac', () => {
    const d = buildDigest(
      '2026-10-29',
      {
        tasks: [
          task('1', 'a', '2026-10-29'),
          task('2', 'b', '2026-10-01'),
          task('3', 'a', '2026-10-30'),
          task('4', 'a', '2026-10-01', false),
          task('5', 'z', '2026-10-01'),
        ],
        diagnoses: [],
        tanks,
      },
      prefs,
      utcDay,
    );
    expect(d).toEqual({
      title: '2 choses à faire pour tes bacs',
      body: 'Tâche 1 (Salon)\nTâche 2 (Nano)',
    });
  });

  it('n’ajoute pas le nom du bac quand il n’y en a qu’un, et regroupe au-delà de 4', () => {
    const many = ['1', '2', '3', '4', '5', '6'].map((id) => task(id, 'a', '2026-10-01'));
    const d = buildDigest(
      '2026-10-29',
      { tasks: many, diagnoses: [], tanks: tanks.slice(0, 1) },
      prefs,
      utcDay,
    );
    expect(d?.title).toBe('6 choses à faire pour tes bacs');
    expect(d?.body.split('\n')).toEqual([
      'Tâche 1',
      'Tâche 2',
      'Tâche 3',
      'Tâche 4',
      'et 2 autre(s)',
    ]);
  });

  it('ajoute les suivis de diagnostic et respecte les préférences', () => {
    const data = {
      tasks: [task('1', 'a', '2026-10-01')],
      diagnoses: [{ tankId: 'b', date: '2026-10-01T10:00:00Z', followUp: { inDays: 1 } }],
      tanks,
    };
    expect(buildDigest('2026-10-29', data, { tasks: false, followUps: true }, utcDay)).toEqual({
      title: 'Une chose à faire pour tes bacs',
      body: 'Suivi du diagnostic : Nano',
    });
    expect(buildDigest('2026-10-29', data, { tasks: true, followUps: false }, utcDay)?.body).toBe(
      'Tâche 1 (Salon)',
    );
  });
});
