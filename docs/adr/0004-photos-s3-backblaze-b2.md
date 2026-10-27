# ADR-0004 : photos sur Backblaze B2 (S3), envoi par URL signée

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27

## Contexte
Les photos doivent suivre l'utilisateur entre ses appareils. La base (0,5 Go) ne peut pas les stocker. Le serveur Render (512 Mo, mise en veille) supporte mal le transit de fichiers.

## Décision
- Stockage objet **Backblaze B2**, via son API compatible S3. Bucket privé.
- L'appli compresse la photo (WebP, 1600 px max), demande à l'API une **URL signée** (un objet, ~5 min, type et taille fixés, nom choisi par l'API), envoie directement à B2, puis confirme à l'API qui enregistre les métadonnées.
- Lecture également par URL signée. CORS du bucket limité à l'URL GitHub Pages.
- Nettoyage des objets non confirmés après 24 h ; quota par utilisateur.

## Conséquences
- L'appli ne détient jamais d'identifiant B2 ; l'API garde le contrôle de chaque accès.
- Le serveur ne transporte aucun fichier : pas de pression mémoire, pas d'attente de réveil pour l'envoi lui-même.
- 10 Go gratuits ≈ 25 000 à 50 000 photos compressées.
- API S3 standard : passer à Cloudflare R2 ou AWS S3 ne change que la configuration.

## Alternatives écartées
- **Photos dans PostgreSQL** : quota de 0,5 Go dépassé très vite.
- **Faire transiter les photos par l'API** : plus lent, consomme la RAM et le quota d'heures, sans gain de sécurité.
- **Cloudflare R2, AWS S3, Firebase Storage** : carte bancaire demandée.
- **Supabase Storage** (1 Go, pause), **Cloudinary / ImageKit** (non S3, format propriétaire).
