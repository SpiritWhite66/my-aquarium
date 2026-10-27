# ADR-0013 : contenus des utilisateurs : signalement et modération

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
Les utilisateurs stockeront des photos et proposeront des fiches au référentiel. L'éditeur est alors hébergeur au sens de la LCEN et du règlement européen DSA : pas de surveillance générale, mais obligation d'agir promptement sur un contenu illicite signalé, et de fournir un point de contact. Les très petites entreprises sont dispensées de la plupart des obligations supplémentaires du DSA.

## Décision
- **Photos privées** : visibles uniquement par leur propriétaire, donc pas de diffusion publique et peu de risque.
- **Fiches proposées** (quand elles existeront) : publiées seulement après validation par l'admin.
- **Bouton « Signaler »** sur tout contenu visible par d'autres + adresse de contact ; formulaire avec motif.
- Traitement des signalements : retrait si manifestement illicite, information de l'auteur avec le motif, possibilité de contester.
- Journal des signalements et décisions, conservé un an.
- Retrait des métadonnées EXIF des photos (ADR-0008).

## Conséquences
- Une table `reports` et un petit écran d'admin, à faire en même temps que les propositions de fiches.
- À réévaluer si des contenus deviennent publics (partage de bacs, galerie).

## Alternatives écartées
- **Modération automatique par IA** : inutile à ce volume, et pas d'IA pour remplir le référentiel.
