import { afterEach, describe, expect, it } from 'vitest';
import { bootApp, closeApp, type App } from '../testing/app.testing';

let app: App;
afterEach(() => closeApp(app));

/** Chaque page s'affiche avec des données réalistes et montre son contenu clé. */
const PAGES: [string, string | RegExp][] = [
  ['/', 'Bac salon'],
  ['/bacs', 'Nano'],
  ['/bacs/a/population', 'Danio'],
  ['/bacs/a/eau', 'Dernier relevé'],
  ['/bacs/a/entretien', 'Changement d’eau'],
  ['/bacs/a/photos', 'Photos'],
  ['/bacs/b/eau', /CO2/],
  ['/releve?bac=a', 'Nouveau relevé'],
  ['/catalogue', 'Catalogue'],
  ['/catalogue/danio-margaritatus', /Danio/],
  ['/catalogue/nouvelle', /espèce|fiche/i],
  ['/materiel', 'Éclairage'],
  ['/materiel/equipement/e1', 'Éclairage'],
  ['/materiel/equipement/nouveau', 'Nouvel équipement'],
  ['/materiel/consommable/c1', 'Engrais'],
  ['/materiel/consommable/nouveau', 'Nouveau consommable'],
  ['/reglages', 'Réglages'],
  ['/diagnostic?bac=a', 'Diagnostic IA'],
  ['/import-ia', 'Importer depuis l’IA'],
  ['/bacs/nouveau', 'Nouveau bac'],
  ['/bacs/a/modifier', 'Modifier le bac'],
  ['/bacs/a/taches/nouvelle', 'Nouvelle tâche'],
  ['/bacs/a/taches/t1', 'Modifier la tâche'],
  ['/bacs/a/habitants/i1', /Danio/],
];

describe('pages', () => {
  for (const [url, text] of PAGES) {
    it(`affiche ${url}`, async () => {
      app = await bootApp();
      const el = await app.go(url, text);
      expect(el.textContent.length).toBeGreaterThan(20);
    });
  }

  it('annonce un bac inconnu', async () => {
    app = await bootApp();
    await app.go('/bacs/zzz/eau', 'n’existe pas');
  });
});
