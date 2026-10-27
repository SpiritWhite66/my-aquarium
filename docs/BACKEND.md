# Conception du backend

Statut : proposition, rien n'est encore implémenté.

## 1. Point de départ

- L'appli est une PWA hors ligne : toutes les données vivent dans IndexedDB (Dexie). Elle doit **continuer à marcher sans réseau**.
- Le backend sert à deux choses :
  1. **Référentiels partagés** : espèces (le vivant), matériel, consommables. Lus par tout le monde, écrits par l'administrateur.
  2. **Données personnelles** : bacs, habitants, relevés, tâches, photos… Synchronisées entre les appareils d'un même utilisateur, avec sauvegarde côté serveur.
- Contraintes : hébergement **gratuit**, **sans carte bancaire**.

## 2. Recommandation : un seul service, deux modules

Je déconseille deux microservices pour l'instant.

| | 2 microservices | 1 service modulaire |
|---|---|---|
| Hébergement gratuit | Les heures gratuites de Render sont **partagées par compte** (750 h/mois). Deux services sollicités souvent les dépassent. | Tient dans le quota |
| Démarrage à froid | Deux réveils de ~30-60 s (Render endort un service après 15 min d'inactivité) | Un seul |
| Base de données | Une base par service, ou une base partagée, ce qui annule l'intérêt | Une base, deux schémas |
| Coût de maintenance | Deux CI, deux déploiements, appels réseau entre services | Un seul |

On découpe le code comme deux microservices (modules séparés, chacun son schéma SQL, aucune jointure entre les deux, communication par une interface interne). Si un jour il faut les séparer, on extrait un module sans réécrire.

```
┌──────────── PWA (GitHub Pages) ────────────┐
│ Dexie (source locale) ── file de synchro    │
└───────────────┬─────────────────────────────┘
                │ HTTPS / JSON
┌───────────────▼──────────── Render (free) ─┐
│  API unique                                  │
│  ├─ module referentiel  → schéma "ref"       │
│  └─ module aquarium     → schéma "aqua"      │
└───────────────┬─────────────────────────────┘
                │
        PostgreSQL (Neon, free)
   Photos : stockage objet (Cloudflare R2) ou rester en local
```

## 3. Hébergement et base de données

**À revérifier au moment de s'inscrire** : les offres gratuites changent souvent.

| Besoin | Choix | Pourquoi | Limites connues |
|---|---|---|---|
| API | **Render** Web Service free | Déploiement depuis GitHub ou Docker, sans carte | 512 Mo RAM, mise en veille après 15 min, 750 h/mois par compte |
| Base | **Neon** Postgres free | Sans carte, ne périme pas, mise en veille automatique | ~0,5 Go de stockage, réveil en ~1 s |
| Photos (optionnel) | **Cloudflare R2** | 10 Go gratuits | Demande une carte : à éviter, voir plus bas |

À éviter :
- **Postgres de Render** : la base gratuite est supprimée au bout de 30 jours.
- **Supabase** : correct, mais le projet est mis en pause après une semaine sans activité.
- **MongoDB Atlas M0** : gratuit et sans carte, mais nos données sont relationnelles (bac → habitants → espèce).

Pour les **photos** : les garder **en local uniquement** au début, comme aujourd'hui. 0,5 Go de base ne suffit pas pour les stocker. Leur synchronisation est une étape ultérieure.

Alternatives pour l'API si Render pose problème : Koyeb (1 service gratuit), Fly.io (carte demandée), Cloudflare Workers + D1 (gratuit, mais SQLite et un autre modèle de code).

## 4. Pile technique

- **Node 26 + TypeScript**, framework **Fastify** (léger, démarre vite, ce qui compte avec la mise en veille), ou **NestJS** pour une structure proche d'Angular.
- **Drizzle ORM** + migrations SQL versionnées.
- Validation avec **Zod**. On partage les types avec le front dans un dossier `shared/`, ce qui fait de ce dépôt un monorepo.
- Spring Boot est possible, mais déconseillé ici : démarrage lent et 512 Mo de RAM, c'est juste.

## 5. Module référentiel

Données publiques, en lecture seule pour les utilisateurs.

```
ref.species      (id, nom_scientifique, noms_communs[], famille, temp_min/max, ph_min/max,
                  gh_min/max, taille_adulte, groupe_min, comportement, source, updated_at)
ref.equipment    (id, type [filtre|éclairage|chauffage|…], marque, modèle, caractéristiques jsonb, updated_at)
ref.consumable   (id, type [engrais|conditionneur|nourriture|test…], marque, nom, unité, updated_at)
```

API :
- `GET /ref/species?since=<date>` : renvoie seulement ce qui a changé depuis cette date. L'appli garde une copie dans Dexie et l'utilise hors ligne.
- `GET /ref/species/:id`, idem pour equipment et consumable.
- Écriture réservée au rôle admin. Saisie manuelle ou import CSV ; pas de remplissage automatique par IA.
- Réponses avec `ETag` / `Cache-Control` : le service worker les met en cache.

Les **fiches personnalisées** (espèce créée par l'utilisateur) restent dans le module aquarium. Elles ne polluent pas le référentiel commun.

## 6. Module aquarium

Données privées, toujours filtrées par `user_id`.

```
aqua.tank, aqua.inhabitant, aqua.water_test, aqua.task, aqua.equipment_item,
aqua.custom_species, aqua.photo_meta
```

- Les tables reprennent les stores Dexie actuels (format de sauvegarde v1), ce qui réutilise l'import/export existant.
- Chaque ligne porte `id` (UUID généré **sur l'appareil**), `user_id`, `updated_at`, `deleted_at` (suppression logique pour la synchro).
- Les références au référentiel sont des identifiants simples (`species_id`), sans clé étrangère entre schémas.

## 7. Synchronisation (le point le plus délicat)

Modèle **local d'abord** : l'appli écrit toujours dans Dexie, puis synchronise quand le réseau est là.

1. Chaque écriture locale ajoute une entrée dans une table Dexie `outbox`.
2. `POST /sync/push` : envoie les changements en attente. Le serveur applique la règle « **la dernière modification gagne** », champ par champ ou ligne par ligne, selon `updated_at`.
3. `GET /sync/pull?since=<curseur>` : récupère ce qui a changé ailleurs, suppressions comprises.
4. La synchro se déclenche au démarrage, au retour du réseau et après chaque modification (avec un délai).

« La dernière modification gagne » suffit pour une personne avec 2 ou 3 appareils. Pas besoin de CRDT.

## 8. Comptes et sécurité

- Connexion **sans mot de passe à gérer** : lien magique par e-mail, ou « Se connecter avec Google » (OAuth/OIDC).
- Jetons JWT courts + jeton de renouvellement dans un cookie `HttpOnly`, `Secure`, `SameSite=None` (front et API sont sur deux domaines).
- CORS limité à l'URL GitHub Pages.
- Toutes les requêtes du module aquarium filtrent sur `user_id`. Tests dédiés : un utilisateur ne voit jamais les données d'un autre.
- Limite de débit sur les routes de connexion.
- Secrets (URL Neon, clé JWT) dans les variables d'environnement Render, jamais dans le dépôt.
- La CI existante s'étend au backend : npm audit, CodeQL, Dependabot, tests.
- RGPD : export (déjà fait côté appli) et suppression complète du compte.

## 9. Démarrage à froid

Render endort le service gratuit après 15 min d'inactivité ; le premier appel prend alors 30 à 60 s. Avec le modèle local d'abord, **l'utilisateur ne le voit pas** : l'appli affiche ses données locales et la synchro se fait en arrière-plan. Ne pas ajouter de « ping » toutes les 14 min pour garder le service éveillé : cela consomme tout le quota d'heures.

## 10. Étapes proposées

1. **Référentiel seul**, sans compte : API en lecture, l'appli remplace son catalogue embarqué par une copie synchronisée. Risque faible, et cela valide Render + Neon.
2. **Comptes** : connexion, sauvegarde manuelle vers le serveur (envoi du JSON de sauvegarde existant).
3. **Synchronisation automatique** (outbox, push/pull).
4. **Photos** sur un stockage objet, si le besoin se confirme.

## 11. Questions ouvertes

- Le référentiel est-il édité uniquement par toi, ou les utilisateurs peuvent-ils proposer des fiches ?
- L'appli aura-t-elle d'autres utilisateurs, ou est-ce un usage personnel multi-appareils ?
- Préférence de langage côté serveur : TypeScript (recommandé, partage des types) ou Java/Spring ?
