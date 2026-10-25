# Plan de réalisation

Voir [APP.md](APP.md) pour l'objectif et le périmètre.

## Étape 0 — Design
- [ ] Générer les maquettes dans OpenDesign (tableau de bord, détail d'un bac, catalogue, saisie d'un relevé, réglages).
- [ ] Valider la palette et le thème clair/sombre.

## Étape 1 — Socle technique
- [ ] Créer le projet Angular 22 (standalone, zoneless, routing, SCSS).
- [ ] Ajouter Angular Material 3 et le thème personnalisé.
- [ ] Ajouter `@angular/pwa` (manifeste, icônes, service worker).
- [ ] Mettre en place le pipeline GitLab CI : lint, tests, build, déploiement sur Pages (`base-href` adapté).
- [ ] Créer le squelette de navigation : barre d'onglets en bas (mobile), barre latérale (ordinateur).

## Étape 2 — Modèle de données et stockage
- [ ] Définir les interfaces TypeScript : `Tank`, `Species`, `Inhabitant`, `InhabitantEvent`, `WaterTest`, `MaintenanceTask`, `MaintenanceLog`.
- [ ] Utiliser des UUID et un champ `updatedAt` sur chaque enregistrement (pour la future synchro).
- [ ] Créer la base Dexie avec ses index et sa gestion de versions (migrations).
- [ ] Créer des repositories abstraits, une implémentation Dexie et des services exposant des signals.
- [ ] Écrire des tests unitaires des repositories.

## Étape 3 — Bacs
- [ ] Liste des bacs (cartes) et formulaire de création/modification.
- [ ] Page de détail d'un bac avec trois onglets : Population, Eau, Entretien.
- [ ] Archivage.

## Étape 4 — Catalogue d'espèces
- [ ] Rédiger le catalogue JSON de départ (~30 espèces, dont Neritina, Red Cherry, Danio margaritatus et Apistogramma borellii, avec une large part de plantes).
- [ ] Charger le catalogue au premier lancement, puis gérer ses mises à jour.
- [ ] Écran de recherche avec filtres par type, et fiches détaillées faune et flore.
- [ ] Création et modification de fiches personnelles.
- [ ] Enrichissement par GBIF et Wikidata (nom scientifique, photo), avec cache local.

## Étape 5 — Inventaire
- [ ] Ajout d'une espèce à un bac : quantité, unité, origine, prix, emplacement.
- [ ] Liste de la population, faune et flore au même niveau, avec badges.
- [ ] Journal des événements par habitant (naissance, décès, taille, bouture…).
- [ ] Moteur de compatibilité : plages d'eau, herbivores en bac planté, prédation, banc minimal, volume minimal.

## Étape 6 — Paramètres de l'eau
- [ ] Formulaire de saisie rapide (pavé numérique, dernières valeurs en indication).
- [ ] Calcul des plages idéales d'un bac à partir de sa population.
- [ ] Graphiques Chart.js avec la plage idéale affichée en bande colorée.
- [ ] Mise en évidence des valeurs hors plage.

## Étape 7 — Entretien
- [ ] Tâches récurrentes par bac, avec modèles par défaut selon le type de bac.
- [ ] Bouton « fait » : création de l'historique et recalcul de l'échéance.
- [ ] Historique en chronologie.

## Étape 8 — Tableau de bord et réglages
- [ ] Tableau de bord : état des bacs, tâches dues et en retard, alertes.
- [ ] Export et import JSON, avec validation et numéro de version du format.
- [ ] Choix du thème.

## Étape 9 — Finitions V1
- [ ] Tests de bout en bout sur les parcours principaux.
- [ ] Vérification hors ligne et installation PWA (Android, ordinateur).
- [ ] Accessibilité : contrastes, navigation au clavier.
- [ ] Déploiement de la V1 sur GitLab Pages.

## Après la V1
1. **Backend et synchronisation** : remplacer l'implémentation Dexie des repositories par une implémentation API (avec cache local).
2. **Serveur MCP** : outils pour lire les bacs et les relevés, ajouter un relevé et valider une tâche depuis Claude.ai.
3. **Matériel et stock** de consommables.
4. **Notifications push**, journal photo, alimentation et éclairage.
