import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFakeIndexedDb, waitFor } from '../core/fake-db.testing';
import { AQUARIUM_DB, AquariumDb } from '../core/db';
import { CareRepo } from '../core/data/care.repo';
import { TankRepo } from '../core/data/tank.repo';
import { DoseSheet } from './dose-sheet';

let db: AquariumDb;
let n = 0;
let fixture: ComponentFixture<DoseSheet>;
const el = () => fixture.nativeElement as HTMLElement;

const until = (check: () => boolean) => waitFor(check, 2000, () => fixture.detectChanges());

async function open(tankId: string): Promise<void> {
  fixture = TestBed.createComponent(DoseSheet);
  fixture.componentRef.setInput('tankId', tankId);
  fixture.detectChanges();
}

beforeEach(() => {
  useFakeIndexedDb();
  db = new AquariumDb(`dose-${n++}`);
  TestBed.configureTestingModule({ providers: [{ provide: AQUARIUM_DB, useValue: db }] });
});

afterEach(async () => {
  TestBed.resetTestingModule();
  await db.delete();
});

const tank = { name: 'Salon', type: 'planted', volumeGross: 60, startDate: '2026-01-01', co2: false, archived: false } as const;

describe('saisie des doses d’engrais', () => {
  it('reprend les produits et les doses de la dernière fois', async () => {
    const tankId = await TestBed.inject(TankRepo).saveTank(tank);
    await TestBed.inject(CareRepo).logDoses(tankId, [
      { product: 'NPK', amount: 5, unit: 'ml' },
      { product: 'Fer', amount: 2, unit: 'pump' },
    ]);
    await open(tankId);
    await until(() => el().querySelectorAll('.dose').length === 2);
    const inputs = [...el().querySelectorAll<HTMLInputElement>('.dose input')].map((i) => i.value);
    expect(inputs).toEqual(['NPK', '5', 'Fer', '2']);
  });

  it('enregistre une ligne par produit et ignore les lignes vides', async () => {
    const tankId = await TestBed.inject(TankRepo).saveTank(tank);
    await open(tankId);
    await until(() => el().querySelectorAll('.dose').length === 1);
    const [product, amount] = [...el().querySelectorAll<HTMLInputElement>('.dose input')];
    product.value = 'NPK';
    product.dispatchEvent(new Event('input'));
    amount.value = '2,5';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('button.add')!.click(); // ligne vide ajoutée
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('button.fill')!.click();
    await waitFor(() => false, 150).catch(() => undefined); // laisse l'écriture se terminer
    const logs = await db.logs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toMatchObject({ product: 'NPK', amount: 2.5, unit: 'ml' });
    expect(logs[0].type).toBe('fertilize');
  });

  it('désactive « C’est fait » tant qu’aucun produit n’est saisi', async () => {
    const tankId = await TestBed.inject(TankRepo).saveTank(tank);
    await open(tankId);
    await until(() => el().querySelectorAll('.dose').length === 1);
    expect(el().querySelector<HTMLButtonElement>('button.fill')!.disabled).toBe(true);
  });
});
