import type { ErrorHandler } from '@angular/core';
import { Injectable, inject, signal } from '@angular/core';

const QUOTA =
  'Plus de place pour enregistrer sur cet appareil. Libère de l’espace (photos, autres sites), puis réessaie.';
const GENERIC =
  'Une action n’a pas abouti : la dernière modification n’est peut-être pas enregistrée. Réessaie, et recharge l’appli si le problème revient.';

const nameOf = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string'
    ? e.name
    : undefined;

/** Message montré à l'utilisateur pour une erreur imprévue. */
export function messageFor(error: unknown): string {
  // Dexie enveloppe l'erreur du navigateur dans `inner`.
  const inner =
    typeof error === 'object' && error !== null && 'inner' in error ? error.inner : undefined;
  return nameOf(error) === 'QuotaExceededError' || nameOf(inner) === 'QuotaExceededError'
    ? QUOTA
    : GENERIC;
}

/** Dernière erreur imprévue, affichée en bandeau par la coquille de l'appli. */
@Injectable({ providedIn: 'root' })
export class ErrorReport {
  readonly message = signal<string | null>(null);

  report(error: unknown): void {
    this.message.set(messageFor(error));
  }

  dismiss(): void {
    this.message.set(null);
  }
}

/**
 * Filet de sécurité : reçoit toute erreur non gérée (y compris une promesse lancée avec `void` qui échoue,
 * via `provideBrowserGlobalErrorListeners`), la garde dans la console et prévient l'utilisateur.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly errors = inject(ErrorReport);

  handleError(error: unknown): void {
    // eslint-disable-next-line no-console -- trace utile au débogage, en plus du message affiché
    console.error(error);
    this.errors.report(error);
  }
}
