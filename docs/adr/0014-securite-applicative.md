# ADR-0014 : sécurité applicative et de l'infrastructure

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
RGPD article 32 : mesures de sécurité adaptées au risque. Référentiel choisi : OWASP ASVS niveau 1, complété des points ci-dessous.

## Décision
- **Transport** : HTTPS partout, HSTS.
- **En-têtes** : CSP stricte (`default-src 'self'`, API et B2 seulement en `connect-src`/`img-src`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`.
- **Authentification** : ADR-0007 ; jetons de renouvellement stockés hachés, rotation à chaque usage, révocation (déconnexion à distance).
- **Autorisation** : filtrage par `user_id` dans une couche commune, jamais à la main dans chaque route ; tests d'isolation sur chaque route.
- **Entrées** : validation Zod de chaque requête, taille de corps limitée, requêtes SQL paramétrées (Drizzle).
- **Abus** : limite de débit par IP et par compte, plus stricte sur la connexion et l'export.
- **Secrets** : variables d'environnement Render, clés à droits minimaux (B2 limitée au bucket, rôle Postgres sans droits d'administration), rotation documentée.
- **Données au repos** : chiffrement fourni par Neon et B2 ; sauvegardes chiffrées.
- **Journaux** : sans e-mail, jeton ni contenu ; identifiant utilisateur pseudonymisé ; 30 jours.
- **Chaîne d'approvisionnement** : déjà en place (Dependabot, npm audit, CodeQL, actions épinglées par SHA), étendue à `api/`.
- **Violation de données** : procédure écrite dans `docs/rgpd/violation.md` : évaluer, notifier la CNIL sous 72 h si risque, informer les utilisateurs si risque élevé, consigner dans un registre des violations.

## Conséquences
- Une liste de contrôle de sécurité par étape du plan.
- Tests de sécurité automatisés (isolation, en-têtes, limites de débit).

## Alternatives écartées
- **Sécurité « au cas par cas »** sans référentiel : oublis probables.
- **Audit externe payant** : hors budget ; envisageable plus tard.
