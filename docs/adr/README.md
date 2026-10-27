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
| [0008](0008-conformite-rgpd.md) | Conformité RGPD : principes, registre, sous-traitants | Acceptée |
| [0009](0009-droit-effacement-conservation.md) | Droit à l'effacement et durées de conservation | Acceptée |
| [0010](0010-droit-acces-portabilite.md) | Droit d'accès et portabilité : export des données | Acceptée |
| [0011](0011-cgu-confidentialite-consentement.md) | CGU, confidentialité, mentions légales, consentement | Acceptée |
| [0012](0012-pas-de-traceurs.md) | Pas de traceurs non essentiels, donc pas de bandeau cookies | Acceptée |
| [0013](0013-contenus-utilisateurs-signalement.md) | Contenus des utilisateurs : signalement et modération | Acceptée |
| [0014](0014-securite-applicative.md) | Sécurité applicative et de l'infrastructure | Acceptée |

Conception d'ensemble : [../BACKEND.md](../BACKEND.md).

Les ADR 0008 à 0014 (sécurité et droit européen) ne remplacent pas un conseil juridique.
