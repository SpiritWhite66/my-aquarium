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

## Comptes (étape 3)

L'interrupteur `ACCOUNTS_OPEN` de `src/app/core/api-config.ts` est **ouvert** : l'appli montre la section Compte, l'écran de connexion et les textes légaux. La connexion n'aboutit pas encore (le serveur répond « service d'envoi d'e-mails non disponible ») tant que ceci n'est pas fait :

1. E-mails par **Brevo** (code prêt) : créer le compte, valider l'expéditeur, créer une clé d'API (filtrage par IP désactivé), puis sur Render `MAIL_TRANSPORT=brevo`, `MAIL_FROM` (l'expéditeur validé) et `BREVO_API_KEY`.
2. Sur Render : `JWT_SECRET` (≥ 32 caractères, `openssl rand -base64 36`), `ADMIN_EMAILS` (ton adresse), et les variables du service d'e-mails. `LOGIN_URL` est déjà dans `render.yaml`. `MAIL_TRANSPORT=console` est interdit en production.
3. Relire les textes légaux et vérifier les adresses des hébergeurs.
4. Tester le cookie sur Safari / iOS.

## À savoir sur l'offre gratuite

- Le service s'endort après ~15 min sans requête : la première requête met environ une minute. L'appli reste utilisable hors ligne.
- Pas de commande de pré-déploiement : d'où les migrations au démarrage (une seule instance).
- Surveiller `/health` avec un service gratuit (étape 7).
