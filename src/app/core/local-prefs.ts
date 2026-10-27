// Préférences propres à cet appareil, lisibles tout de suite au démarrage (avant IndexedDB) :
// thème, date de la dernière sauvegarde, report du rappel. Elles ne font pas partie des sauvegardes :
// une restauration sur un autre appareil ne doit pas en emporter les réglages.
// (Les préférences structurées, comme les notifications, vivent dans la table `prefs` de Dexie.)

export type LocalPrefKey = 'theme' | 'lastBackup' | 'backupSnooze';

/** null si la préférence est absente ou si le stockage est indisponible (navigation privée, données bloquées). */
export function readPref(key: LocalPrefKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: LocalPrefKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la préférence ne sera pas gardée */
  }
}
