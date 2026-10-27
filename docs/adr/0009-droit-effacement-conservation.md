# ADR-0009 : droit à l'effacement (droit à l'oubli) et durées de conservation

- Statut : Proposée
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
Article 17 du RGPD : l'utilisateur peut demander l'effacement de ses données. Article 5 : les données ne sont pas conservées plus longtemps que nécessaire.

## Décision
- **Suppression du compte en libre-service** dans l'appli, avec confirmation (ressaisie de l'e-mail ou nouveau lien magique).
- Effacement **immédiat et définitif** : lignes `aqua.*`, objets B2, jetons, compte. Pas de suppression logique pour un compte supprimé.
- Les fiches proposées au référentiel et publiées sont conservées mais **anonymisées** (`created_by` vidé).
- **Sauvegardes de la base** : conservées 30 jours au plus ; un compte supprimé disparaît donc des sauvegardes sous 30 jours. Indiqué dans la politique de confidentialité.
- **Lignes supprimées par synchro** (`deleted_at`) purgées définitivement après 90 jours.
- **Comptes inactifs** : e-mail d'avertissement après 24 mois sans connexion, suppression 30 jours plus tard sans réaction.
- **Journaux techniques** : 30 jours, sans contenu des requêtes.
- Les données locales de l'appareil restent sous le contrôle de l'utilisateur : l'appli propose de les effacer aussi.
- Demandes reçues hors appli (e-mail) traitées sous un mois.

## Conséquences
- Test automatisé : après suppression, aucune ligne ni objet B2 ne reste pour cet utilisateur.
- Tâche planifiée de purge (lignes supprimées, comptes inactifs, objets orphelins).

## Alternatives écartées
- **Désactivation au lieu de suppression** : non conforme à une demande d'effacement.
- **Conservation illimitée des comptes inactifs** : contraire à la limitation de conservation.
