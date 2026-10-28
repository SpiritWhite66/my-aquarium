import { InjectionToken } from '@angular/core';

/**
 * Adresse de l'API du backend (sans « / » final), par exemple `https://mon-api.onrender.com`.
 * `null` si l'API n'est pas déployée : le réglage « Catalogue en ligne » est alors indisponible
 * et l'appli fonctionne comme avant, avec son catalogue intégré.
 */
const API_BASE_URL: string | null = 'https://mes-aquariums-api.onrender.com';

export const API_URL = new InjectionToken<string | null>('API_URL', {
  providedIn: 'root',
  factory: () => API_BASE_URL,
});

/**
 * Comptes (connexion par lien envoyé par e-mail). Fermés (`false`), l'appli n'a ni écran de connexion
 * ni section « Compte » ni liens vers les textes légaux. Ouverts, la connexion n'aboutit que si le
 * serveur sait envoyer des e-mails (étape 3c du plan).
 */
const ACCOUNTS_OPEN = true;

export const ACCOUNTS_ENABLED = new InjectionToken<boolean>('ACCOUNTS_ENABLED', {
  providedIn: 'root',
  factory: () => ACCOUNTS_OPEN,
});
