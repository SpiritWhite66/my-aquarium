import { LEGAL_VERSIONS } from '@aquarium/shared';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS_ENABLED } from './api-config';
import { LEGAL } from './legal';
import { TestBed } from '@angular/core/testing';

describe('textes légaux', () => {
  it('ont les mêmes versions que le serveur', () => {
    expect(LEGAL.versions.cgu).toBe(LEGAL_VERSIONS.cgu);
    expect(LEGAL.versions.confidentialite).toBe(LEGAL_VERSIONS.confidentialite);
  });

  it('ont une adresse de contact avant l’ouverture des comptes', () => {
    if (TestBed.inject(ACCOUNTS_ENABLED)) {
      expect(LEGAL.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }
  });

  it('portent une date au format AAAA-MM-JJ', () => {
    expect(LEGAL.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
