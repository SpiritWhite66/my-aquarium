# ADR-0008 : conformité RGPD : principes, registre, sous-traitants

- Statut : Proposée
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
L'appli devient ouverte à plusieurs utilisateurs dans l'UE. Elle traite des données personnelles (e-mail, identifiant Google, photos, données de bacs rattachées à une personne). Le RGPD s'applique, même pour un projet gratuit et non commercial.

## Décision
- **Responsable de traitement** : l'éditeur de l'appli (toi), identifié dans les mentions légales.
- **Base légale** : exécution du contrat (CGU) pour le compte et la synchro ; aucune donnée utilisée à d'autres fins.
- **Minimisation** : on collecte l'e-mail et c'est tout. Pas de nom, pas de date de naissance, pas de localisation ; métadonnées EXIF (dont GPS) retirées des photos sur l'appareil avant envoi.
- **Registre des traitements** tenu dans `docs/rgpd/registre.md` (traitement, finalité, données, durée, sous-traitants).
- **Sous-traitants** : Render, Neon, Backblaze, service d'e-mail, Google (connexion). Pour chacun : accepter son DPA (accord de sous-traitance), choisir la région UE quand elle existe, documenter les transferts hors UE (clauses contractuelles types / Data Privacy Framework).
- **Hébergement UE** : Neon et B2 en région Europe ; Render en région Frankfurt.
- **Analyse d'impact (AIPD)** : non requise (pas de données sensibles, pas de profilage, pas de grande échelle). À réévaluer si cela change.

## Conséquences
- Chaque nouvelle donnée collectée ou nouveau fournisseur impose de mettre à jour le registre et la politique de confidentialité.
- Le choix d'un fournisseur dépend aussi de son DPA et de sa région, pas seulement de la gratuité.

## Alternatives écartées
- **Collecter un pseudo ou un nom** : inutile au service.
- **Hébergement hors UE** : complique la conformité sans bénéfice.
