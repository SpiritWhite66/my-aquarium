# ADR-0012 : pas de traceurs non essentiels (cookies)

- Statut : Acceptée (2026-10-27)
- Date : 2026-10-27
- Portée : ADR transverse

## Contexte
Directive ePrivacy et lignes directrices CNIL : tout cookie ou stockage local non strictement nécessaire exige un consentement préalable (bandeau).

## Décision
- **Seuls des traceurs strictement nécessaires** : cookie de session/renouvellement, IndexedDB et cache du service worker pour le fonctionnement hors ligne, préférence de thème.
- **Aucune mesure d'audience, publicité, police ou script tiers** chargé depuis un autre domaine.
- Donc **pas de bandeau cookies** ; la politique de confidentialité liste ces traceurs et leur rôle.
- Si une mesure d'audience devient nécessaire : outil exempté de consentement selon la CNIL (ex. Matomo configuré en mode exempté), décision dans un nouvel ADR.

## Conséquences
- Polices et bibliothèques auto-hébergées.
- Règle vérifiée par la CSP (ADR-0014), qui bloque les domaines tiers.

## Alternatives écartées
- **Google Analytics ou équivalent** : consentement obligatoire, transferts hors UE, sans besoin réel.
