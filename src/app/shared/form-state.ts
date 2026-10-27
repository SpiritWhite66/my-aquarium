import { computed, linkedSignal, untracked, type WritableSignal } from '@angular/core';

/**
 * Champ de formulaire prérempli depuis une fiche déjà enregistrée. Il prend la valeur de la fiche une
 * seule fois, quand elle apparaît (ou quand on passe à une autre fiche), puis appartient à la personne qui
 * saisit : les mises à jour de la base pendant la saisie ne l'écrasent pas.
 * `initial` : valeur sans fiche (ou fonction qui la calcule, par exemple depuis l'URL).
 */
export function fromEntity<E extends { id: string }, T>(entity: () => E | undefined, pick: (e: E) => T, initial: T | (() => T)): WritableSignal<T> {
  // Un `computed` intermédiaire : le champ n'est recalculé que si l'identifiant change, pas à chaque mise à jour de la fiche.
  const id = computed(() => entity()?.id);
  const empty = computed(() => (typeof initial === 'function' ? (initial as () => T)() : initial));
  return linkedSignal<{ key: string | undefined; empty: T }, T>({
    source: () => ({ key: id(), empty: empty() }),
    computation: ({ key, empty }) => {
      const e = key ? untracked(entity) : undefined;
      return e ? pick(e) : empty;
    },
  });
}

/**
 * Bac choisi par défaut : celui demandé (lien) s'il existe, sinon le premier. Une fois choisi, le bac reste
 * tant qu'il existe, même si la liste des bacs change. `forced` (le bac d'une fiche qu'on modifie) l'emporte
 * dès qu'il apparaît.
 */
export function defaultTank(tankIds: () => string[], requested: () => string | undefined, forced: () => string | undefined = () => undefined): WritableSignal<string> {
  return linkedSignal<{ ids: string[]; requested: string | undefined; forced: string | undefined }, string>({
    source: () => ({ ids: tankIds(), requested: requested(), forced: forced() }),
    computation: ({ ids, requested, forced }, previous) => {
      if (forced && forced !== previous?.source.forced) return forced;
      if (previous?.value && (ids.includes(previous.value) || previous.value === forced)) return previous.value;
      return ids.find((id) => id === requested) ?? ids.at(0) ?? '';
    },
  });
}
