import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { defaultTank, fromEntity } from './form-state';

describe('fromEntity', () => {
  it('prend la valeur par défaut tant que la fiche n’est pas chargée', () => {
    TestBed.runInInjectionContext(() => {
      const e = signal<{ id: string; name: string } | undefined>(undefined);
      expect(fromEntity(e, (x) => x.name, 'vide')()).toBe('vide');
    });
  });

  it('se remplit quand la fiche apparaît', () => {
    TestBed.runInInjectionContext(() => {
      const e = signal<{ id: string; name: string } | undefined>(undefined);
      const name = fromEntity(e, (x) => x.name, '');
      e.set({ id: 'a', name: 'Salon' });
      expect(name()).toBe('Salon');
    });
  });

  it('ne perd pas la saisie quand la base se met à jour', () => {
    TestBed.runInInjectionContext(() => {
      const e = signal<{ id: string; name: string } | undefined>({ id: 'a', name: 'Salon' });
      const name = fromEntity(e, (x) => x.name, '');
      expect(name()).toBe('Salon'); // lu une première fois, comme le fait le gabarit
      name.set('Salon modifié');
      e.set({ id: 'a', name: 'Salon (autre écriture)' });
      expect(name()).toBe('Salon modifié');
    });
  });

  it('se recharge quand on passe à une autre fiche', () => {
    TestBed.runInInjectionContext(() => {
      const e = signal<{ id: string; name: string } | undefined>({ id: 'a', name: 'Salon' });
      const name = fromEntity(e, (x) => x.name, '');
      name.set('brouillon');
      e.set({ id: 'b', name: 'Nano' });
      expect(name()).toBe('Nano');
    });
  });

  it('revient à la valeur par défaut quand la fiche disparaît', () => {
    TestBed.runInInjectionContext(() => {
      const e = signal<{ id: string; name: string } | undefined>({ id: 'a', name: 'Salon' });
      const name = fromEntity(e, (x) => x.name, 'vide');
      e.set(undefined);
      expect(name()).toBe('vide');
    });
  });
});

describe('defaultTank', () => {
  it('le bac demandé, sinon le premier, sinon rien', () => {
    TestBed.runInInjectionContext(() => {
      const ids = signal<string[]>([]);
      const wanted = signal<string | undefined>('b');
      const tank = defaultTank(ids, wanted);
      expect(tank()).toBe('');
      ids.set(['a', 'b']);
      expect(tank()).toBe('b');
    });
    TestBed.runInInjectionContext(() => {
      expect(defaultTank(() => ['a', 'b'], () => 'inconnu')()).toBe('a');
      expect(defaultTank(() => ['a', 'b'], () => undefined)()).toBe('a');
    });
  });

  it('garde le choix de la personne quand la liste change', () => {
    TestBed.runInInjectionContext(() => {
      const ids = signal(['a', 'b', 'c']);
      const tank = defaultTank(ids, () => 'a');
      tank.set('c');
      ids.set(['a', 'b', 'c']);
      expect(tank()).toBe('c');
    });
  });

  it('retombe sur un bac existant si le choisi disparaît', () => {
    TestBed.runInInjectionContext(() => {
      const ids = signal(['a', 'b']);
      const tank = defaultTank(ids, () => undefined);
      tank.set('b');
      ids.set(['a']);
      expect(tank()).toBe('a');
    });
  });

  it('ne change pas de bac quand le lien change après coup', () => {
    TestBed.runInInjectionContext(() => {
      const wanted = signal<string | undefined>('a');
      const tank = defaultTank(() => ['a', 'b'], wanted);
      expect(tank()).toBe('a');
      wanted.set('b');
      expect(tank()).toBe('a');
    });
  });

  it('le bac d’une fiche à modifier l’emporte dès qu’il apparaît, puis la saisie reprend la main', () => {
    TestBed.runInInjectionContext(() => {
      const forced = signal<string | undefined>(undefined);
      const tank = defaultTank(() => ['a', 'b'], () => undefined, forced);
      expect(tank()).toBe('a');
      forced.set('b');
      expect(tank()).toBe('b');
      tank.set('a');
      expect(tank()).toBe('a');
    });
  });
});
