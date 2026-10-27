# Décisions d'architecture (ADR)

Chaque fichier décrit une décision : contexte, choix, conséquences, alternatives écartées. Une décision remplacée n'est pas supprimée : on passe son statut à « Remplacée par ADR-xxxx ».

| N° | Décision | Statut |
|---|---|---|
| [0001](0001-service-unique-modulaire.md) | Un seul service backend, découpé en modules | Acceptée |
| [0002](0002-hebergement-render.md) | Héberger l'API sur Render (offre gratuite) | Acceptée |
| [0003](0003-postgresql-neon.md) | PostgreSQL hébergé chez Neon | Acceptée |
| [0004](0004-photos-s3-backblaze-b2.md) | Photos sur Backblaze B2 (S3), envoi par URL signée | Acceptée |
| [0005](0005-node-fastify.md) | Node.js + TypeScript + Fastify | Acceptée |
| [0006](0006-local-d-abord-synchro.md) | Local d'abord, synchro « la dernière modification gagne » | Acceptée |
| [0007](0007-authentification-sans-mot-de-passe.md) | Connexion sans mot de passe (lien e-mail ou Google) | Acceptée |

Conception d'ensemble : [../BACKEND.md](../BACKEND.md).
