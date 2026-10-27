# ADR-0001 : un seul service backend, découpé en modules

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27

## Contexte
Deux domaines : les référentiels partagés (vivant, matériel, consommables) et les données personnelles (bacs, relevés, tâches, photos). L'idée de départ était deux microservices. L'hébergement doit être gratuit et sans carte bancaire.

## Décision
Une seule API, avec deux modules isolés comme s'ils étaient deux services :
- un schéma SQL par module (`ref`, `aqua`), aucune jointure ni clé étrangère entre les deux ;
- le module aquarium n'utilise le référentiel que par une interface interne ;
- règle vérifiée en CI (lint des imports entre modules).

## Conséquences
- Un seul déploiement, un seul réveil après mise en veille, quota Render respecté.
- Extraire un module en service séparé plus tard reste possible sans réécriture.
- Il faut de la discipline pour ne pas coupler les modules : d'où la règle de lint.

## Alternatives écartées
- **Deux microservices** : le quota gratuit de Render (750 h/mois) est partagé par compte, deux réveils au lieu d'un, appels réseau entre services, deux CI. Aucun besoin d'échelle qui le justifie.
