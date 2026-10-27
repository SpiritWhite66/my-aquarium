// Banc d'essai de l'interface : le routeur complet sur une base simulée remplie de données réalistes.
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AQUARIUM_DB, AquariumDb } from '../core/db';
import { useFakeIndexedDb, waitFor } from '../core/fake-db.testing';
import type { Consumable, Diagnosis, Equipment, Inhabitant, MaintenanceLog, MaintenanceTask, Observation, Tank, WaterTest } from '../core/models';

registerLocaleData(localeFr);

let n = 0;
const U = '2026-10-25T21:10:35.873Z';

export interface App {
  db: AquariumDb;
  harness: RouterTestingHarness;
  /** Ouvre une adresse et attend que la page ait affiché `text` (ou, à défaut, que les données soient chargées). */
  go(url: string, text?: string | RegExp): Promise<HTMLElement>;
  /** Attend qu'une condition soit vraie en rafraîchissant l'affichage. */
  until(check: () => boolean): Promise<void>;
  el(): HTMLElement;
  /** Remplit un champ comme le ferait une saisie. */
  type(target: Element | null, value: string): void;
  click(target: Element | null): void;
  /** Premier élément qui correspond au sélecteur (et au texte, s'il est donné). */
  find(selector: string, text?: string | RegExp): HTMLElement | null;
  /** Clique sur l'élément trouvé, ou échoue si absent. */
  press(selector: string, text?: string | RegExp): void;
  flush(): Promise<void>;
}

export const tankA: Tank = { id: 'a', updatedAt: U, name: 'Bac salon', type: 'planted', volumeGross: 60, volumeNet: 50, startDate: '2026-03-01', co2: false, archived: false, substrate: 'Sable', lighting: { model: 'Rampe', photoperiodHours: 8 } };
export const tankB: Tank = { id: 'b', updatedAt: U, name: 'Nano', type: 'planted', volumeGross: 30, startDate: '2026-06-01', co2: true, co2Target: 2, archived: false };

export async function seedAll(db: AquariumDb): Promise<void> {
  const day = (i: number) => `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`;
  await db.tanks.bulkPut([tankA, tankB]);
  await db.inhabitants.bulkPut([
    { id: 'i1', updatedAt: U, tankId: 'a', speciesId: 'danio-margaritatus', quantity: 12, unit: 'individual', addedDate: '2026-09-01', status: 'healthy' },
    { id: 'i2', updatedAt: U, tankId: 'b', speciesId: 'paracheirodon-innesi', quantity: 8, unit: 'individual', addedDate: '2026-09-01', status: 'sick' },
  ] satisfies Inhabitant[]);
  await db.inhabitantEvents.bulkPut([{ id: 'ev1', updatedAt: U, inhabitantId: 'i1', tankId: 'a', date: '2026-09-01', type: 'added', quantityDelta: 12 }] as never);
  await db.waterTests.bulkPut(
    Array.from({ length: 8 }, (_, i): WaterTest => ({ id: `w${i}`, updatedAt: U, tankId: 'a', date: day(i), values: { ph: 7 - 0.1 * i, no3: 10 + i * 5, po4: 0.5 + i * 0.3, kh: 4, gh: 7, temp: 24 } })),
  );
  await db.tasks.bulkPut([
    { id: 't1', updatedAt: U, tankId: 'a', type: 'water_change', label: 'Changement d’eau', everyDays: 7, nextDue: '2026-10-20', active: true },
    { id: 't2', updatedAt: U, tankId: 'a', type: 'water_test', label: 'Test', everyDays: 7, nextDue: '2026-11-30', active: true },
  ] satisfies MaintenanceTask[]);
  await db.logs.bulkPut([{ id: 'l1', updatedAt: U, tankId: 'a', type: 'water_change', label: 'Changement d’eau', date: day(10), details: { waterChangedLiters: 20 } }] satisfies MaintenanceLog[]);
  await db.observations.bulkPut([{ id: 'o1', updatedAt: U, tankId: 'a', date: day(10), overall: 'watch', findings: [], algaeLevel: 2, manual: true }] satisfies Observation[]);
  await db.equipment.bulkPut([
    { id: 'e1', updatedAt: U, tankId: 'a', type: 'light', name: 'Éclairage', light: { channels: ['Blanc'], intensityPct: 60, schedule: { on: '10:00', off: '18:00' } } },
    { id: 'e2', updatedAt: U, tankId: 'b', type: 'co2', name: 'CO2 nano' },
    { id: 'e3', updatedAt: U, type: 'filter', name: 'Filtre de rechange' },
  ] satisfies Equipment[]);
  await db.consumables.bulkPut([{ id: 'c1', updatedAt: U, name: 'Engrais', category: 'fertilizer', level: 'low' }] satisfies Consumable[]);
  await db.co2Readings.bulkPut([{ id: 'r1', updatedAt: U, tankId: 'b', date: day(10), bubblesPerMinute: 2, phBefore: 7.4, phAfter: 6.6 }]);
  await db.diagnoses.bulkPut([
    { id: 'g1', updatedAt: U, tankId: 'a', date: day(10), summary: 'Algues', hypotheses: [{ title: 'Excès de lumière', probability: 'high' }], actions: [{ title: 'Réduire', priority: 'now', task: { type: 'custom', label: 'Réduire' } }], followUp: { inDays: 7, measure: ['NO3'] } },
  ] satisfies Diagnosis[]);
}

/** Démarre l'appli sur une base neuve. `seed` : remplit la base avant l'affichage (par défaut : jeu de données complet). */
export async function bootApp(seed: ((db: AquariumDb) => PromiseLike<unknown>) | false = seedAll): Promise<App> {
  useFakeIndexedDb();
  const db = new AquariumDb(`ui-${n++}`);
  TestBed.configureTestingModule({
    providers: [
      { provide: AQUARIUM_DB, useValue: db },
      { provide: LOCALE_ID, useValue: 'fr-FR' },
      provideRouter(routes, withComponentInputBinding(), withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    ],
  });
  if (seed) await seed(db);
  const harness = await RouterTestingHarness.create();
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      harness.detectChanges();
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const el = () => harness.routeNativeElement as HTMLElement;
  const until = (check: () => boolean) => waitFor(check, 3000, () => harness.detectChanges());
  return {
    db,
    harness,
    el,
    flush,
    until,
    async go(url, text) {
      await harness.navigateByUrl(url);
      await flush();
      if (text) await until(() => (typeof text === 'string' ? el().textContent.includes(text) : text.test(el().textContent)));
      else await flush();
      return el();
    },
    type(target, value) {
      const input = target as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      harness.detectChanges();
    },
    click(target) {
      (target as HTMLElement).click();
      harness.detectChanges();
    },
    find(selector, text) {
      return [...el().querySelectorAll<HTMLElement>(selector)].find((e) => !text || (typeof text === 'string' ? e.textContent.includes(text) : text.test(e.textContent))) ?? null;
    },
    press(selector, text) {
      const target = [...el().querySelectorAll<HTMLElement>(selector)].find((e) => !text || (typeof text === 'string' ? e.textContent.includes(text) : text.test(e.textContent)));
      if (!target) throw new Error(`Introuvable : ${selector} ${String(text ?? '')}`);
      target.click();
      harness.detectChanges();
    },
  };
}

/** Coquille complète de l'appli (menus, lien d'évitement) sur la même base de test. */
export async function bootShell(seed: ((db: AquariumDb) => PromiseLike<unknown>) | false = seedAll) {
  useFakeIndexedDb();
  const db = new AquariumDb(`shell-${n++}`);
  TestBed.configureTestingModule({
    providers: [
      { provide: AQUARIUM_DB, useValue: db },
      { provide: LOCALE_ID, useValue: 'fr-FR' },
      provideRouter(routes, withComponentInputBinding(), withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    ],
  });
  if (seed) await seed(db);
  const { App: Shell } = await import('../app');
  const { Router } = await import('@angular/router');
  const fixture = TestBed.createComponent(Shell);
  const router = TestBed.inject(Router);
  fixture.detectChanges();
  await router.navigateByUrl('/');
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  await settle();
  return { db, fixture, router, el: fixture.nativeElement as HTMLElement, settle };
}

export async function closeApp(app: App): Promise<void> {
  TestBed.resetTestingModule();
  await app.db.delete();
}
