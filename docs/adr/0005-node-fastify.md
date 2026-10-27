# ADR-0005 : Node.js + TypeScript + Fastify

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27

## Contexte
L'appli est en Angular / TypeScript. L'API fait peu de calcul. On veut un démarrage rapide (mise en veille Render) et une petite empreinte mémoire.

## Décision
- Node 26 (≥ 26.12.1), TypeScript, **Fastify**.
- **Drizzle** pour la base, **Zod** pour la validation.
- Types et schémas partagés avec l'appli dans un dossier `shared/` (monorepo).
- Production : JavaScript compilé à l'avance, image `node:26-slim` en build multi-étapes, dépendances de production seulement, connexion à la base à la première requête, route `/health` sans base.

## Conséquences
- Un seul langage pour tout le projet, mêmes outils de CI (npm audit, CodeQL, Dependabot).
- Démarrage de l'API en moins d'une seconde ; le réveil reste dominé par Render.

## Alternatives écartées
- **Rust** : démarre en ~10 ms et consomme ~10 Mo, mais gagne moins d'une seconde sur un réveil de 30-60 s. Développement plus lent, pas de types partagés.
- **Spring Boot** : démarrage lent, mémoire juste avec 512 Mo.
- **NestJS** : structure proche d'Angular, mais plus lourd au démarrage.
