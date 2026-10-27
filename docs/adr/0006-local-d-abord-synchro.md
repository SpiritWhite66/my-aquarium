# ADR-0006 : local d'abord, synchro « la dernière modification gagne »

- Statut : Proposée
- Date : 2026-10-27

## Contexte
L'appli est une PWA qui fonctionne entièrement hors ligne avec IndexedDB (Dexie). Le serveur peut mettre 30-60 s à se réveiller. Un utilisateur a quelques appareils.

## Décision
- Dexie reste la source pour l'affichage ; toute écriture est locale.
- Chaque modification entre dans une file `outbox`, envoyée par `POST /sync/push` ; les changements des autres appareils arrivent par `GET /sync/pull?since=`.
- Identifiants UUID générés sur l'appareil, `updated_at` et suppression logique (`deleted_at`) sur chaque ligne.
- Conflit : la dernière modification gagne (selon `updated_at`).
- Le référentiel est copié localement et mis à jour par `?since=`.

## Conséquences
- L'appli reste utilisable sans réseau et ne voit jamais le réveil du serveur.
- Deux modifications simultanées du même élément sur deux appareils : l'une est perdue. Acceptable pour un usage personnel.
- Horloges d'appareils décalées : le serveur peut horodater à la réception pour limiter le problème.
- Le format de sauvegarde existant sert de base au schéma serveur.

## Alternatives écartées
- **Appli en ligne uniquement** : casse le hors-ligne actuel et expose le réveil de Render.
- **CRDT (Automerge, Yjs)** : utile pour l'édition collaborative, trop complexe ici.
- **Sauvegarde manuelle seulement** : simple, gardée comme première étape, insuffisante à terme.
