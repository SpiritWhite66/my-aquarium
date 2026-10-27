# ADR-0011 : CGU, politique de confidentialité, mentions légales et consentement

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
- LCEN (France) : mentions légales obligatoires (éditeur, hébergeur).
- RGPD articles 12 à 14 : informer clairement sur les traitements.
- Les CGU encadrent l'usage, les contenus des utilisateurs et la responsabilité.
- Majorité numérique en France : 15 ans.

## Décision
- Trois pages dans l'appli, accessibles sans compte et hors ligne : **Mentions légales**, **Politique de confidentialité**, **Conditions d'utilisation**.
- Documents versionnés dans le dépôt (`docs/legal/`), avec date et numéro de version.
- À l'inscription : case à cocher non pré-cochée « J'accepte les CGU et j'ai lu la politique de confidentialité » + déclaration d'avoir au moins 15 ans.
- Acceptation tracée : `user_consents(user_id, document, version, accepted_at)`.
- Nouvelle version importante des CGU : nouvelle acceptation demandée à la connexion suivante ; changements résumés.
- Les CGU couvrent : service gratuit sans garantie de disponibilité, contenus proposés par les utilisateurs (licence sur les fiches proposées au référentiel), règles de conduite, suspension de compte, droit applicable.
- Point de contact unique (adresse e-mail dédiée) pour les droits RGPD et les signalements.

## Conséquences
- Les textes sont à rédiger (modèles CNIL) puis à faire relire si possible ; ce dépôt ne remplace pas un conseil juridique.
- L'éditeur est **un particulier, à titre non professionnel** : la LCEN (art. 6) lui permet de ne publier que le nom de l'hébergeur et un moyen de contact, en communiquant son identité à l'hébergeur. Les mentions légales suivent ce modèle. À revoir si l'activité devient professionnelle.

## Alternatives écartées
- **Acceptation implicite (« en utilisant l'appli vous acceptez »)** : non opposable, consentement non démontrable.
