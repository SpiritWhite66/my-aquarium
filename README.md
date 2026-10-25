# Mes aquariums

Application web (PWA) personnelle pour gérer plusieurs aquariums d'eau douce : paramètres de l'eau, entretien, faune et flore.

- Objectif et périmètre : [APP.md](APP.md)
- Plan de réalisation : [PLAN.md](PLAN.md)

## Développement

```bash
nvm use            # Node 24
npm install
npm start          # http://localhost:4200
npm test -- --watch=false
npm run build
```

Les données sont stockées dans le navigateur (IndexedDB). Pense à exporter une sauvegarde depuis Réglages.
