/**
 * Textes légaux : versions en vigueur et coordonnées. Les versions doivent rester identiques à
 * `LEGAL_VERSIONS` du serveur (`shared/src/auth.ts`) : une modification importante des textes
 * exige de changer les deux, pour que chaque compte soit invité à accepter la nouvelle version.
 */
export const LEGAL = {
  versions: { cgu: '1', confidentialite: '3' },
  /** Date de la version en vigueur. */
  updated: '2026-10-29',
  /** Adresse de contact (droits RGPD, signalements). Obligatoire dès que les comptes sont ouverts (un test le vérifie). */
  contactEmail: 'vguillamot@gmail.com' as string | null,
};
