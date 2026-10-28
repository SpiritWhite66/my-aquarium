import { afterEach, describe, expect, it, vi } from 'vitest';
import { withLock } from './locks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubLocks = (request: unknown) => {
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
};

describe('withLock', () => {
  it('exécute directement sans gestionnaire de verrous', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
    expect(await withLock('v', 100, () => Promise.resolve(42))).toBe(42);
  });

  it('exécute sous le verrou demandé, avec une limite d’attente', async () => {
    const request = vi.fn(
      (_n: string, opts: { signal: AbortSignal }, cb: () => Promise<number>) => {
        expect(opts.signal).toBeInstanceOf(AbortSignal);
        return cb();
      },
    );
    stubLocks(request);
    expect(await withLock('verrou', 100, () => Promise.resolve(7))).toBe(7);
    expect(request).toHaveBeenCalledWith('verrou', expect.anything(), expect.any(Function));
  });

  it('n’attend pas indéfiniment un verrou tenu par un onglet gelé', async () => {
    // Le verrou n'est jamais accordé : la demande échoue quand le délai expire.
    stubLocks(
      (_n: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(opts.signal.reason as Error);
          });
        }),
    );
    const fn = vi.fn(() => Promise.resolve('fait'));
    expect(await withLock('verrou', 20, fn)).toBe('fait');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('laisse remonter une erreur de la fonction, sans la relancer', async () => {
    stubLocks((_n: string, _o: unknown, cb: () => Promise<void>) => cb());
    const fn = vi.fn(() => Promise.reject(new Error('panne')));
    await expect(withLock('verrou', 100, fn)).rejects.toThrow('panne');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
