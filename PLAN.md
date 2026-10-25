# Plan de réalisation

Voir [APP.md](APP.md) pour l'objectif et le périmètre.

## Étape 0 — Design
- [x] Maquettes dans Claude Design (accueil, détail d'un bac, catalogue, saisie d'un relevé, réglages, version ordinateur).
- [x] Palette et thème clair/sombre validés.

## Étape 1 — Socle technique
- [x] Projet Angular 22 (standalone, zoneless, routing, SCSS).
- [x] Système de design sur mesure repris de la maquette (Angular Material abandonné : le design est sur mesure).
- [x] `@angular/pwa` (manifeste, icônes, service worker).
- [x] Pipeline GitHub Actions : tests, build, déploiement sur GitHub Pages.
- [x] Navigation : barre d'onglets en bas (mobile), barre latérale (ordinateur).
- [x] Logo et icônes de l'app aux couleurs du design (`public/logo.svg`).

## Étape 2 — Modèle de données et stockage
- [x] Interfaces TypeScript (`src/app/core/models.ts`).
- [x] UUID et `updatedAt` sur chaque enregistrement.
- [x] Base Dexie avec index et versionnement.
- [x] Service unique `AquariumStore` exposant des signals (seule classe à remplacer pour le futur backend).
- [ ] Tests des opérations de stockage.

## Étape 3 — Bacs
- [x] Liste des bacs (cartes) et formulaire de création/modification.
- [x] Détail d'un bac avec onglets Population, Eau, Entretien.
- [x] Archivage et suppression.
- [x] Photos du bac (couverture, galerie) et des habitants, incluses dans la sauvegarde.

## Étape 4 — Catalogue d'espèces
- [x] Catalogue de départ (34 espèces, dont Neritina, Red Cherry, Danio margaritatus et Apistogramma borellii, autant de plantes que de poissons).
- [x] Mise à jour automatique du catalogue intégré au démarrage.
- [x] Recherche, filtres par type, filtre « compatible avec mon bac », filtre « sans CO2 ».
- [x] Fiche détaillée faune et flore, avec barres de paramètres comparées au bac.
- [ ] Création et modification de fiches personnelles.
- [ ] Enrichissement par GBIF et Wikidata (photos, taxonomie).

## Étape 5 — Inventaire
- [x] Ajout d'une espèce à un bac depuis sa fiche.
- [x] Population : flore puis faune, avec badges.
- [x] Fiche habitant : quantité, état, emplacement, journal (naissance, décès, taille, bouture…).
- [x] Moteur de compatibilité : plages d'eau, herbivores, prédation, groupe minimal, volume minimal, CO2.

## Étape 6 — Paramètres de l'eau
- [x] Saisie rapide avec valeurs précédentes et contrôle immédiat de la plage.
- [x] Plages idéales calculées d'après la population.
- [x] Graphiques avec plage idéale en bande colorée.
- [x] Valeurs hors plage mises en évidence, historique des relevés.
- [ ] Pavé numérique intégré de la maquette (actuellement : clavier numérique du téléphone).

## Étape 7 — Entretien
- [x] Tâches récurrentes par bac, modèles par défaut à la création.
- [x] Bouton « fait » : historique et recalcul de l'échéance.
- [x] Chronologie commune entretien + événements des habitants.

## Étape 8 — Tableau de bord et réglages
- [x] Tableau de bord : alertes, état des bacs, tâches du jour et en retard.
- [x] Export et import JSON versionnés.
- [x] Choix du thème.

## Étape 8 ter — Photos
- [x] Table `photos` (Blob réduits + vignettes), ajout depuis l'appareil photo ou la galerie, légendes.
- [x] Onglet Photos d'un bac, photos par habitant, visionneuse, photo de couverture.
- [x] Export/import JSON des photos.
- [x] Comparaison avant/après (curseur ou côte à côte), écart en jours, espèces ajoutées entre-temps ; aussi pour un habitant (croissance d'une plante).
- [ ] Envoyer une photo directement à l'import IA.

## Étape 8 bis — Assistant IA (photo → JSON)
- [x] Schéma `ai/my-aquarium-ai.schema.json` v1 : `inventory`, `water_test` (tests en gouttes), `sanity` (bilan visuel).
- [x] Skill Claude `ai/SKILL.md` + prompt autonome, générés par `npm run ai` (zip et prompt servis par l'app).
- [x] Écran « Importer depuis l'IA » : collage, fichier ou partage Android, validation par le schéma, aperçu modifiable.
- [x] Rattachement des espèces au catalogue, fiche personnelle pour une espèce inconnue, remplacement ou ajout des quantités.
- [x] Bilans visuels enregistrés par bac, constats à cocher, alertes sur l'accueil.
- [ ] Tester le skill avec de vraies photos de tes bacs et de tes tests en gouttes, puis affiner les consignes.

## Étape 8 quater — Confort et matériel
- [x] Stockage persistant, état du stockage, rappel de sauvegarde.
- [x] Fiches personnelles (création, modification, personnalisation d'une fiche intégrée).
- [x] Déplacement d'un habitant entre bacs (partiel ou complet) ; correction et datation des relevés.
- [x] Changement d'eau détaillé avec estimation des nitrates.
- [x] Tendances, suivi du cyclage, mode vacances, export agenda (.ics).
- [x] Envoi d'une photo à une app d'IA depuis la visionneuse.
- [x] Matériel (garanties) et consommables (niveau, péremption) avec alertes.
- [x] CO2 : débit visé, compteur de bulles, drop checker.

## Étape 9 — Finitions V1
- [x] Tests unitaires des règles métier.
- [ ] Activer GitHub Pages (Settings › Pages › Source : GitHub Actions) et vérifier le déploiement.
- [ ] Tests de bout en bout sur les parcours principaux.
- [ ] Vérification hors ligne et installation PWA (Android, ordinateur).
- [ ] Revue d'accessibilité.

## Après la V1
1. **Backend et synchronisation** : remplacer l'implémentation Dexie d'`AquariumStore` par une implémentation API (avec cache local).
2. **Serveur MCP** : outils pour lire les bacs et les relevés, ajouter un relevé et valider une tâche depuis Claude.ai (les règles de `core/rules.ts` sont réutilisables telles quelles).
3. **Notifications push**, alimentation et programmation de l'éclairage.
4. Capteurs connectés (température, pH).
