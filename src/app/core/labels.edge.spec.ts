import { describe, expect, it } from 'vitest';
import { agoLabel, dueLabel, elapsedLabel, fmt, fmtDate, fmtLongDate, fmtRange, fmtShortDate, fmtTime, frequencyLabel, parseNumber, speciesName, unitLabel } from './labels';
import type { Species } from './models';

const nbsp = /[\u00a0\u202f\u0020]/g;
const plain = (s: string) => s.replace(nbsp, ' ');

describe('nombres', () => {
  it('écrit à la française, avec au plus deux décimales', () => {
    expect(fmt(7)).toBe('7');
    expect(fmt(7.5)).toBe('7,5');
    expect(fmt(7.256)).toBe('7,26');
    expect(fmt(0)).toBe('0');
    expect(fmt(-1.5)).toBe('-1,5');
    expect(plain(fmt(1234.5))).toBe('1 234,5');
  });

  it('un nombre absent ou invalide donne un tiret', () => {
    expect(fmt(undefined)).toBe('—');
    expect(fmt(null)).toBe('—');
    expect(fmt(NaN)).toBe('—');
  });

  it('écrit une plage avec son unité facultative', () => {
    expect(fmtRange(6.5, 7.5)).toBe('6,5–7,5');
    expect(fmtRange(22, 26, '°C')).toBe('22–26 °C');
    expect(fmtRange(0, 0.1, '')).toBe('0–0,1');
  });

  it('lit une saisie française ou anglaise', () => {
    expect(parseNumber('6,8')).toBe(6.8);
    expect(parseNumber('6.8')).toBe(6.8);
    expect(parseNumber('  12  ')).toBe(12);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('0')).toBe(0);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('   ')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber('1,2,3')).toBeUndefined();
    expect(parseNumber('Infinity')).toBeUndefined();
  });
});

describe('noms et unités', () => {
  const species = (o: Partial<Species>) => ({ id: 's', scientificName: 'Danio margaritatus', commonNames: [], kind: 'fish', source: 'builtin', ...o }) as Species;

  it('accorde l’unité selon la quantité', () => {
    expect(unitLabel('individual', 1)).toBe('individu');
    expect(unitLabel('individual', 2)).toBe('individus');
    expect(unitLabel('individual', 0)).toBe('individu');
    expect(unitLabel('stem', 1)).toBe('pied');
    expect(unitLabel('stem', 5)).toBe('pieds');
  });

  it('nomme une espèce par son nom commun, sinon scientifique, sinon « inconnue »', () => {
    expect(speciesName(species({ commonNames: ['Danio perlé'] }))).toBe('Danio perlé');
    expect(speciesName(species({}))).toBe('Danio margaritatus');
    expect(speciesName(undefined)).toBe('Espèce inconnue');
  });
});

describe('dates', () => {
  it('met la première lettre en capitale', () => {
    expect(fmtLongDate(new Date(2026, 9, 27))).toBe('Mardi 27 octobre');
    expect(fmtShortDate('2026-10-27')).toMatch(/^Mar\.? 27 oct\.?$/);
  });

  it('lit une date seule comme une date locale, un horodatage comme un instant', () => {
    expect(fmtShortDate('2026-10-27')).toMatch(/27 oct/);
    expect(fmtShortDate(new Date(2026, 9, 28, 12).toISOString())).toMatch(/28 oct/);
    expect(plain(fmtDate('2026-10-27'))).toBe('27 oct. 2026');
    expect(plain(fmtDate(new Date(2026, 0, 5, 12).toISOString()))).toBe('5 janv. 2026');
  });

  it('écrit l’heure sur deux chiffres', () => {
    expect(fmtTime(new Date(2026, 9, 27, 9, 5).toISOString())).toBe('09:05');
    expect(fmtTime(new Date(2026, 9, 27, 21, 30).toISOString())).toBe('21:30');
  });

  it.each([
    ['2026-10-27', 'aujourd’hui'],
    ['2026-10-28', 'demain'],
    ['2026-10-29', 'dans 2 j'],
    ['2026-11-06', 'dans 10 j'],
    ['2026-10-26', 'en retard de 1 j'],
    ['2026-10-20', 'en retard de 7 j'],
  ])('échéance %s → %s', (due, label) => expect(dueLabel(due, '2026-10-27')).toBe(label));

  it.each([
    ['2026-10-27', 'aujourd’hui'],
    ['2026-10-28', 'aujourd’hui'],
    ['2026-10-26', 'hier'],
    ['2026-10-25', 'il y a 2 j'],
    ['2026-10-17', 'il y a 10 j'],
  ])('relevé du %s → %s', (date, label) => expect(agoLabel(date, '2026-10-27')).toBe(label));

  it('tient compte du jour local d’un horodatage', () => {
    expect(agoLabel(new Date(2026, 9, 26, 23, 30).toISOString(), '2026-10-27')).toBe('hier');
  });

  it.each([
    [0, 'Le même jour'],
    [1, '1 jour'],
    [2, '2 jours'],
    [-12, '12 jours'],
    [44, '44 jours'],
    [45, '45 jours (environ 1 mois)'],
    [87, '87 jours (environ 3 mois)'],
    [699, '699 jours (environ 23 mois)'],
    [700, '700 jours (environ 1,9 ans)'],
    [1000, '1000 jours (environ 2,7 ans)'],
  ])('écart de %d jours → %s', (days, label) => expect(elapsedLabel(days)).toBe(label));
});

describe('fréquence', () => {
  it.each([
    [1, 'Quotidien'],
    [7, 'Hebdo'],
    [30, 'Mensuel'],
    [31, 'Mensuel'],
    [14, 'Toutes les 2 sem.'],
    [21, 'Toutes les 3 sem.'],
    [60, 'Tous les 60 j'],
    [3, 'Tous les 3 j'],
    [29, 'Tous les 29 j'],
    [32, 'Tous les 32 j'],
  ])('%d jours → %s', (days, label) => expect(frequencyLabel(days)).toBe(label));
});
