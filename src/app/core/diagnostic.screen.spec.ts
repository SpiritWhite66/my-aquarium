// Préparation du dossier de diagnostic à l'écran : suivi, photos cochées, informations manquantes.
import { describe, expect, it } from 'vitest';
import type { Diagnosis, Photo } from './models';
import { defaultPhotoSelection, dossierFileName, followUpByDefault, followUpDueLabel, missingInfo } from './diagnostic';

const diag = (date: string, followUp?: Diagnosis['followUp']): Diagnosis =>
  ({ id: 'g', updatedAt: '', tankId: 't', date, summary: '', hypotheses: [], actions: [], followUp }) as Diagnosis;
const photo = (id: string, date: string): Photo => ({ id, updatedAt: '', tankId: 't', date, width: 1, height: 1 });

describe('followUpByDefault', () => {
  it('coché si le dernier diagnostic a moins de 90 jours', () => {
    expect(followUpByDefault(diag('2026-08-01T10:00:00'), '2026-10-27')).toBe(true); // 87 jours
    expect(followUpByDefault(diag('2026-07-29T10:00:00'), '2026-10-27')).toBe(true); // 90 jours pile
    expect(followUpByDefault(diag('2026-07-28T10:00:00'), '2026-10-27')).toBe(false); // 91 jours
  });
  it('décoché sans diagnostic précédent', () => expect(followUpByDefault(undefined, '2026-10-27')).toBe(false));
});

describe('followUpDueLabel', () => {
  const fmt = (iso: string) => `[${iso}]`;
  const d = diag('2026-10-20T10:00:00', { inDays: 10 }); // suivi prévu le 30 octobre
  it('dans N jours', () => expect(followUpDueLabel(d, '2026-10-27', fmt)).toBe('suivi prévu dans 3 j'));
  it('aujourd’hui', () => expect(followUpDueLabel(d, '2026-10-30', fmt)).toBe('suivi prévu aujourd’hui'));
  it('en retard : la date prévue', () => expect(followUpDueLabel(d, '2026-11-02', fmt)).toBe('suivi prévu le [2026-10-30]'));
  it('vide sans suivi prévu ou sans diagnostic', () => {
    expect(followUpDueLabel(diag('2026-10-20T10:00:00'), '2026-10-27', fmt)).toBe('');
    expect(followUpDueLabel(undefined, '2026-10-27', fmt)).toBe('');
  });
});

describe('defaultPhotoSelection', () => {
  const photos = [photo('p5', '2026-10-25T10:00:00'), photo('p4', '2026-10-24T10:00:00'), photo('p3', '2026-10-22T10:00:00'), photo('p2', '2026-10-15T10:00:00'), photo('p1', '2026-10-10T10:00:00')];
  const prev = diag('2026-10-20T10:00:00');

  it('sans suivi : les 3 plus récentes', () => expect([...defaultPhotoSelection(photos, prev, false)]).toEqual(['p5', 'p4', 'p3']));
  it('suivi demandé mais pas de diagnostic précédent : les 3 plus récentes', () => expect([...defaultPhotoSelection(photos, undefined, true)]).toEqual(['p5', 'p4', 'p3']));
  it('en suivi : celles prises depuis, plus la dernière d’avant', () => expect([...defaultPhotoSelection(photos, prev, true)]).toEqual(['p5', 'p4', 'p3', 'p2']));
  it('en suivi : au plus 3 photos récentes', () => {
    const many = [...['p9', 'p8', 'p7', 'p6'].map((id, i) => photo(id, `2026-10-2${6 - i}T10:00:00`)), ...photos.slice(2)];
    expect([...defaultPhotoSelection(many, prev, true)]).toEqual(['p9', 'p8', 'p7', 'p2']);
  });
  it('en suivi sans photo d’avant', () => expect([...defaultPhotoSelection(photos.slice(0, 2), prev, true)]).toEqual(['p5', 'p4']));
  it('une photo prise à l’instant du diagnostic compte comme « avant »', () => {
    expect([...defaultPhotoSelection([photo('x', prev.date)], prev, true)]).toEqual(['x']);
  });
  it('aucune photo', () => expect(defaultPhotoSelection([], prev, true).size).toBe(0));
});

describe('missingInfo', () => {
  const full = {
    water: { tests: [{ values: { no3: 10, po4: 0.5, kh: 4 } }] },
    equipment: [{ light: { schedule: { on: '10:00', off: '18:00' } } }, { filter: { flowLh: 600 } }],
  } as unknown as Parameters<typeof missingInfo>[0];

  it('rien ne manque', () => expect(missingInfo(full, 2)).toEqual([]));
  it('relevés absents', () => {
    expect(missingInfo({ ...full, water: { tests: [] } } as never, 2)).toEqual(['relevés d’eau']);
  });
  it('mesures de nutriments absentes du dernier relevé', () => {
    const d = { ...full, water: { tests: [{ values: { ph: 7 } }] } } as never;
    expect(missingInfo(d, 2)).toEqual(['NO3', 'PO4', 'KH']);
  });
  it('seul le dernier relevé compte', () => {
    const d = { ...full, water: { tests: [{ values: { no3: 10, po4: 1, kh: 4 } }, { values: { ph: 7 } }] } } as never;
    expect(missingInfo(d, 2)).toEqual(['NO3', 'PO4', 'KH']);
  });
  it('matériel et photos', () => {
    expect(missingInfo({ ...full, equipment: [] } as never, 0)).toEqual(['horaires d’éclairage (Matériel)', 'débit du filtre', 'photos']);
  });
});

describe('dossierFileName', () => {
  it('nom sans accents ni espaces', () => expect(dossierFileName('Salon Été', '2026-10-27')).toBe('dossier-salon-ete-2026-10-27.json'));
  it('pas de tiret en trop', () => expect(dossierFileName('  Nano !! ', '2026-10-27')).toBe('dossier-nano-2026-10-27.json'));
});
