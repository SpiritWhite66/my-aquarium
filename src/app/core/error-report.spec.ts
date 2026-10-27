import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorHandler, ErrorReport, messageFor } from './error-report';

describe('erreurs imprévues', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('explique un stockage plein, signalé directement ou enveloppé par Dexie', () => {
    const quota = new DOMException('plein', 'QuotaExceededError');
    expect(messageFor(quota)).toContain('Plus de place');
    expect(messageFor({ name: 'DatabaseClosedError', inner: quota })).toContain('Plus de place');
  });

  it('donne un message général pour le reste, même sans objet erreur', () => {
    for (const e of [new Error('x'), 'texte', null, undefined, { inner: null }, { name: 3 }]) {
      expect(messageFor(e)).toContain('n’a pas abouti');
    }
  });

  it('le gestionnaire garde la trace et affiche le message, que l’on peut fermer', () => {
    TestBed.configureTestingModule({ providers: [AppErrorHandler] });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('écriture refusée');
    TestBed.inject(AppErrorHandler).handleError(err);
    const report = TestBed.inject(ErrorReport);
    expect(log).toHaveBeenCalledWith(err);
    expect(report.message()).toContain('n’a pas abouti');
    report.dismiss();
    expect(report.message()).toBeNull();
  });
});
