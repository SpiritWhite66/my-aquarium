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
