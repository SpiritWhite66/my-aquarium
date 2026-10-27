# ADR-0002 : héberger l'API sur Render (offre gratuite)

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27

## Contexte
L'appli est sur GitHub Pages. Il faut un hébergement d'API gratuit, sans carte bancaire, déployable depuis GitHub.

## Décision
Render, Web Service gratuit, déployé depuis une image Docker construite à partir du dépôt.

## Conséquences
- 512 Mo de RAM, CPU partagé : suffisant pour une API légère.
- Mise en veille après 15 min sans requête, non réglable ; réveil en 30-60 s. Masqué par le fonctionnement local d'abord (ADR-0006).
- 750 h/mois par compte : couvre un service allumé en continu, pas deux (ADR-0001).
- Pas de « ping » pour garder le service éveillé.
- Image Docker légère et démarrage rapide pour limiter le réveil (ADR-0005).
- Les offres gratuites changent : à revérifier ; l'image Docker permet de migrer facilement.

## Alternatives écartées
- **Koyeb** : un service gratuit, crédible en solution de repli.
- **Fly.io, Railway, AWS, GCP** : carte bancaire demandée.
- **Cloudflare Workers** : démarrage en millisecondes et pas de veille, mais impose la base D1 (SQLite) et un autre modèle d'exécution. À reconsidérer si le réveil devient gênant.
