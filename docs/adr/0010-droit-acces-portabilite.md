# ADR-0010 : droit d'accès et portabilité : export des données

- Statut : Proposée
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
Articles 15 et 20 du RGPD : l'utilisateur peut obtenir une copie de ses données, dans un format structuré et lisible par une machine. L'appli sait déjà exporter une sauvegarde ZIP (JSON v1 + photos) depuis l'appareil.

## Décision
- **Export en libre-service** depuis l'appli : `GET /me/export` produit un ZIP avec :
  - les données au format de sauvegarde v1 (JSON documenté), réimportable dans l'appli ;
  - les photos d'origine stockées sur B2 ;
  - un fichier `compte.json` : e-mail, date d'inscription, versions des CGU acceptées, appareils connectés.
- Le format JSON est décrit dans la documentation (schéma publié).
- Export limité à un par heure par compte, pour protéger les ressources gratuites.
- Le ZIP est généré en flux, sans tout charger en mémoire (512 Mo sur Render).

## Conséquences
- Réutilise l'export existant ; un seul format pour sauvegarde, portabilité et migration.
- Tests : l'export d'un compte contient toutes ses données et aucune d'un autre.

## Alternatives écartées
- **Export sur demande par e-mail, traité à la main** : lent, ne passe pas à l'échelle.
- **Format propriétaire** : contraire à la portabilité.
