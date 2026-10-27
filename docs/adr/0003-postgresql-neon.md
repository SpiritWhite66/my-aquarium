# ADR-0003 : PostgreSQL hébergé chez Neon

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27

## Contexte
Les données sont relationnelles (bac → habitants → espèce, relevés, tâches). Base gratuite, sans carte, qui ne disparaît pas.

## Décision
PostgreSQL, offre gratuite de Neon. Deux schémas : `ref` et `aqua`. Migrations SQL versionnées avec Drizzle.

## Conséquences
- SQL standard : on peut changer d'hébergeur (Supabase, Render payant, auto-hébergé) avec un simple dump.
- Environ 0,5 Go : suffisant pour les données, pas pour les photos (ADR-0004).
- La base se met en veille ; réveil d'environ 1 s, négligeable devant celui de Render.
- `jsonb` disponible pour les caractéristiques variables du matériel.
- Branches Neon utilisables pour tester les migrations.

## Alternatives écartées
- **Postgres gratuit de Render** : supprimé au bout de 30 jours.
- **Supabase** : correct, mais projet mis en pause après une semaine sans activité.
- **MongoDB Atlas** : gratuit, mais modèle document mal adapté à des données reliées.
- **SQLite / D1** : seulement si l'API passe sur Cloudflare Workers.
