# Déploiement de l'API (Render + Neon)

## 1. Base PostgreSQL sur Neon

1. Créer un projet, **région Europe (Francfort)**, PostgreSQL 17.
2. Copier la chaîne de connexion **pooled** (`postgres://…-pooler…?sslmode=require`) : c'est `DATABASE_URL`.

## 2. Service sur Render

1. Dashboard › New › **Blueprint** › choisir le dépôt `SpiritWhite66/my-aquarium` : Render lit [render.yaml](../render.yaml) (Docker, Francfort, offre gratuite, déploiement après la CI).
2. Renseigner les variables marquées « à saisir » :
   - `DATABASE_URL` : la chaîne Neon ;
   - `ADMIN_TOKEN` : 32 caractères ou plus, par exemple `openssl rand -base64 36`.
3. Les migrations se jouent seules au démarrage (`RUN_MIGRATIONS=true`).
4. Vérifier `https://<service>.onrender.com/health`.

## 3. Charger le catalogue (une fois)

Depuis le poste de développement, après `npm run server:build` :

```
CORS_ORIGIN=https://spiritwhite66.github.io DATABASE_URL='<chaîne Neon>' npm run import:ref -w api
```

L'import est rejouable (une fiche inchangée n'est pas réécrite). Vérifier `GET /ref/species`.

## 4. Brancher l'appli

- `src/app/core/api-config.ts` : renseigner l'adresse du service Render.
- `ngsw-config.json` : ajouter l'API aux groupes de données si on veut la mettre en cache.
- Réglages › Catalogue en ligne (bêta) : activer, puis tester hors ligne.

## Comptes (lot 3a, quand on les ouvre)

Ajouter sur Render : `JWT_SECRET` (≥ 32 caractères), `ADMIN_EMAILS` (ton adresse). L'envoi d'e-mails réel (lot 3c) est nécessaire pour se connecter en production ; `MAIL_TRANSPORT=console` y est interdit.

## À savoir sur l'offre gratuite

- Le service s'endort après ~15 min sans requête : la première requête met environ une minute. L'appli reste utilisable hors ligne.
- Pas de commande de pré-déploiement : d'où les migrations au démarrage (une seule instance).
- Surveiller `/health` avec un service gratuit (étape 7).
