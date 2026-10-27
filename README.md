# Mes aquariums

Application web (PWA) personnelle pour gérer plusieurs aquariums d'eau douce : paramètres de l'eau, entretien, faune et flore.

- Objectif et périmètre : [APP.md](APP.md)
- Plan de réalisation : [PLAN.md](PLAN.md)

## Développement

```bash
nvm use            # Node 26 (≥ 26.12.1, corrige Node2Shell)
npm install
npm start          # http://localhost:4200
npm test -- --watch=false               # tests unitaires et d'interface
npm test -- --watch=false --coverage    # + couverture (seuil : 80 %)
npm run mutation                        # tests de mutation (Stryker), ~35 min
npm run build && npm run e2e           # tests de bout en bout (Playwright) sur l'appli compilée
E2E_WEBKIT=1 npm run e2e                # + WebKit (proche de Safari iOS, paquets système requis)
npm run build
```

### Qualité des tests

- **Architecture** : `core/` (règles et calculs purs, sans Angular ni écran), `core/stores/` (lecture par domaine), `core/data/` (écriture), `pages/` et
  `shared/` (écrans, qui appellent seulement le reste). Les calculs d'un écran (courbes, CO2, dossier de diagnostic, chronologie) vivent dans `core/` pour être testés et mutés.
- **Tests** : les règles métier, la couche de données, le store et chaque page sont testés sur une base IndexedDB simulée
  (`src/app/testing/app.testing.ts` démarre le routeur complet avec des données réalistes).
- **Couverture** : calculée sur tout le code de `src/app`, seuil de 80 % imposé (instructions, branches, fonctions, lignes).
- **Mutation** : Stryker modifie le code (inverse une condition, change une borne…) et vérifie qu'un test échoue. Une couverture élevée ne
  prouve pas que les tests vérifient quelque chose ; le score de mutation, si. Il porte sur la logique (`src/app/core/`, dont les dépôts de
  données et le store), pas sur les gabarits des pages. Rapport HTML : `reports/mutation/index.html`. Le score minimal (75 %) fait échouer la commande.

Les données sont stockées dans le navigateur (IndexedDB). Pense à exporter une sauvegarde depuis Réglages.
