# My Aquarium — Objectif de l'application

## Vision

Une application web personnelle (PWA) pour gérer **plusieurs aquariums d'eau douce** : qualité de l'eau, entretien et population.
Les **plantes sont aussi importantes que la faune** (poissons, crevettes, escargots) : même place, même richesse d'information, même entretien suivi.

## Contraintes

- **Usage personnel**, interface en **français**, pensée d'abord pour le **mobile**.
- **PWA** installable, utilisable hors ligne.
- **Hébergement statique** sur GitHub Pages : pas de serveur en V1.
- **Données locales** (IndexedDB), avec **export/import JSON** pour la sauvegarde.
- L'architecture doit permettre d'ajouter plus tard un **backend** et un **serveur MCP** consommable par Claude.ai.

## Stack technique

| Besoin | Choix |
|---|---|
| Framework | Angular 22 (composants standalone, signals, zoneless) |
| Interface | Système de design sur mesure (maquette Claude Design), thèmes clair/sombre/auto, polices Figtree et IBM Plex Mono embarquées |
| Stockage | Dexie (IndexedDB), derrière une couche « repository » |
| Graphiques | Composant SVG maison (courbe + plage idéale) |
| PWA | `@angular/pwa` (service worker + manifeste) |
| Données espèces | Catalogue JSON local, enrichi par GBIF et Wikidata (taxonomie, photos) |
| CI/CD | GitHub Actions → GitHub Pages |
| Environnement | Node 24 (voir `.nvmrc`) |

## Design

Maquette de référence : [Claude Design « Aquariums — PWA »](https://claude.ai/artifact/TcknT1TqZsEF5dbKSWTYzs).
Les jetons de couleur et les composants communs sont dans `src/styles.scss`.

## Fonctionnalités V1

### 1. Bacs
- Création et gestion de plusieurs bacs : nom, type (planté, communautaire, crevettes, quarantaine, nurserie), volume brut et net, dimensions, date de mise en eau, substrat, CO2, éclairage et photopériode.
- Archivage d'un bac.

### 2. Paramètres de l'eau
- Saisie rapide d'un relevé : température, pH, GH, KH, NO2, NO3, NH4, PO4, Fe, CO2, conductivité.
- Graphiques d'évolution par paramètre.
- **Plages idéales calculées** à partir des espèces présentes dans le bac (intersection de leurs plages).
- Mise en évidence des valeurs hors plage.

### 3. Entretien
- Tâches récurrentes par bac : changement d'eau, filtre, vitres, siphonnage, **taille des plantes**, **fertilisation**, recharge CO2, test d'eau, tâche libre.
- Validation « fait » en un geste : historique enregistré, prochaine échéance recalculée.
- Tableau de bord des tâches du jour et en retard (alertes dans l'app, pas de notifications push en V1).

### 4. Inventaire et catalogue
- **Catalogue d'espèces** : poissons, crevettes, escargots, plantes. Fiches intégrées et fiches personnelles.
  - Faune : taille adulte, banc minimal, volume minimal, tempérament, zone de nage, régime, « mange les plantes ».
  - Flore : lumière, CO2, croissance, placement (avant-plan, milieu, arrière-plan, épiphyte, flottante), multiplication, hauteur maximale.
- **Inventaire par bac** : quantité (individus, ou pieds/pots/portions pour les plantes), date d'arrivée, origine, prix, état de santé, emplacement.
- **Journal** par habitant : naissance, décès, maladie, traitement, taille, bouture, déplacement.
- **Alertes de compatibilité** à l'ajout : plages d'eau incompatibles, herbivore dans un bac planté, prédation (par ex. Apistogramma et jeunes crevettes).

### 5. Réglages
- Export et import complets des données en JSON.
- Choix du thème clair ou sombre.

### 6. Photos
- Photos d'un bac (onglet Photos) et de chaque habitant (animal ou plante), prises avec l'appareil photo ou choisies dans la galerie.
- Réduites à ~1600 px avant stockage (une photo de 1 Mo pèse environ 160 Ko), avec une vignette pour la galerie.
- Photo de couverture d'un bac affichée sur sa carte et en tête de sa page ; dernière photo d'un habitant affichée dans la population.
- Comparaison avant / après de deux photos (curseur ou côte à côte) avec l'écart de temps et les espèces ajoutées entre-temps.
- Visionneuse plein écran : navigation, légende, téléchargement (pour l'envoyer à une IA), suppression.
- Incluses dans l'export/import JSON.

### 7. Assistant IA (photo → JSON)
- Une IA (Claude avec le skill `my-aquarium-json`, ou n'importe quelle IA avec le prompt fourni) analyse une photo et renvoie un JSON strict.
- Trois analyses : **inventaire** (espèces et quantités), **relevé** (lecture des tests en gouttes face au nuancier), **bilan visuel** (algues, maladies, carences, eau trouble).
- L'app valide le JSON avec le même schéma que celui donné à l'IA, affiche un aperçu modifiable et n'enregistre rien sans validation.
- Le bac n'est jamais dans le JSON : il est choisi à l'import. Les espèces sont rattachées au catalogue par leur nom scientifique.
- Sources : `ai/SKILL.md` et `ai/my-aquarium-ai.schema.json`. Le futur serveur MCP pourra réutiliser ce format.

### 8. Matériel, consommables et CO2
- Équipements par bac (ou en réserve) : type, marque, modèle, caractéristiques, date d'achat, garantie.
- Consommables (nourriture, engrais, tests, traitements…) : niveau en un geste (plein, moitié, bas, vide), péremption. Alertes stock vide, produit périmé (un test en gouttes périmé fausse les mesures), fin de garantie.
- CO2 : débit visé, compteur de bulles (on tape à chaque bulle, l'app calcule les bulles/minute), couleur du drop checker, historique.

### 9. Aide au quotidien
- Changement d'eau détaillé : pourcentage ou litres, estimation des nitrates après le changement.
- Tendances des paramètres et date estimée de sortie de plage ; alerte si les nitrates vont dépasser dans la semaine.
- Suivi du cyclage d'un nouveau bac (NH4 → NO2 → NO3 → prêt).
- Mode vacances (décale les tâches) et export des rappels vers un agenda (.ics).
- Protection des données : stockage persistant, rappel de sauvegarde tous les 14 jours.
- Fiches espèces personnelles et personnalisation des fiches intégrées ; déplacement d'un habitant entre bacs ; correction des relevés.

### 10. Matériel détaillé et diagnostic IA
- Fiches techniques saisies à la main : éclairage (canaux, horaires, sieste, intensité, niveaux, PAR…), filtration (débit), chauffage, installation CO2 (horaires, électrovanne). Pas de watts ni lumens par litre (peu pertinents avec les rampes RGB).
- Contrôles par bac : durée d'éclairage, brassage, synchronisation CO2/lumière.
- CO2 estimé par KH et pH (3 × KH × 10^(7 − pH)), zone visée 20–30 mg/L, débit de bulles conseillé.
- Diagnostic IA : l'app exporte le dossier complet d'un bac (JSON + photos) pour le skill `my-aquarium-diagnostic` (`ai/diagnostic/SKILL.md`). La réponse (kind `diagnosis`) s'importe : hypothèses, plan d'action, tâches créées, suivi. Les diagnostics précédents et les actions faites sont renvoyés au diagnostic suivant.

## Catalogue de départ

Environ 30 espèces courantes, dont celles déjà possédées :
- *Neritina natalensis* (escargot nérite zèbre)
- *Neocaridina davidi* « Red Cherry »
- *Danio margaritatus* (galaxy rasbora)
- *Apistogramma borellii*

Le reste : poissons, crevettes et escargots courants, plus une large part de **plantes** (Anubias, Cryptocoryne, Microsorum, mousses, Vallisneria, plantes flottantes…).

## Hors périmètre V1 (prévu ensuite)

- **Backend** : synchronisation entre appareils.
- **Serveur MCP** pour interroger et alimenter les données depuis Claude.ai.
- Notifications push (en attendant : export des rappels vers l'agenda).
- Alimentation et programmation de l'éclairage.
- Capteurs connectés.
