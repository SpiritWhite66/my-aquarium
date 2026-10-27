# ADR-0007 : connexion sans mot de passe

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27

## Contexte
Il faut identifier l'utilisateur pour synchroniser ses données. L'appli (GitHub Pages) et l'API (Render) sont sur deux domaines. On veut éviter de stocker et protéger des mots de passe.

## Décision
- Connexion par **lien magique par e-mail** ou **« Se connecter avec Google »** (OIDC).
- Jeton d'accès JWT court ; jeton de renouvellement dans un cookie `HttpOnly`, `Secure`, `SameSite=None`, révocable en base.
- CORS limité à l'URL GitHub Pages ; limite de débit sur les routes de connexion.
- Chaque requête du module aquarium filtre sur `user_id`, avec tests dédiés d'isolation entre utilisateurs.

## Conséquences
- Pas de mot de passe stocké, pas de réinitialisation à gérer.
- Le lien magique nécessite un service d'envoi d'e-mails gratuit (à choisir).
- Les cookies tiers peuvent être bloqués par certains navigateurs (Safari) : prévoir de servir l'API sous un sous-domaine du même site si besoin, ou un repli sur jeton.

## Alternatives écartées
- **Identifiant + mot de passe** : stockage, hachage, réinitialisation, fuites à gérer.
- **Service d'identité externe (Auth0, Clerk)** : gratuit à petite échelle, mais dépendance de plus et quotas.
