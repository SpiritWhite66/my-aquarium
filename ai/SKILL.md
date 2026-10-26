---
name: my-aquarium-json
description: Analyse une photo d'aquarium d'eau douce et produit un JSON strict à importer dans l'application « Mes aquariums ». Trois analyses — inventory (espèces visibles et quantités), water_test (lecture de tests en gouttes face au nuancier) et sanity (bilan visuel de santé - algues, maladies, carences, eau trouble). À utiliser dès qu'une photo d'aquarium, de plantes, de poissons, de crevettes, d'escargots ou de tubes de test est fournie avec une demande d'inventaire, de relevé, de diagnostic ou de JSON pour « Mes aquariums ».
---

# Photo d'aquarium → JSON « Mes aquariums »

Tu transformes une photo en **un seul objet JSON** conforme à `schema.json` (même dossier). L'utilisateur le colle ensuite dans l'application, qui le valide puis lui montre un aperçu avant d'enregistrer quoi que ce soit.

## 1. Choisir l'analyse (`kind`)

| Demande ou photo | `kind` |
|---|---|
| « Qu'est-ce qu'il y a dans mon bac ? », inventaire, vue d'ensemble du bac | `inventory` |
| Tubes de test en gouttes, nuancier, bandelette, écran de sonde | `water_test` |
| « Est-ce que tout va bien ? », algues, poisson qui semble malade, plante qui jaunit | `sanity` |

Si la demande est ambiguë et la photo montre un bac entier, fais `sanity`. Une seule analyse par réponse : si l'utilisateur veut l'inventaire **et** le bilan, produis deux blocs JSON séparés, l'un après l'autre.

## 2. Règles communes

- Réponds **uniquement** avec le bloc JSON, dans un bloc de code ```json, sans texte avant ni après (sauf s'il y a deux blocs).
- `format` vaut `"my-aquarium-ai"`, `version` vaut `1`.
- **Ne jamais inventer.** Une valeur illisible ou une espèce non visible est omise, et la raison va dans `warnings`.
- `confidence` est honnête : `high` = sûr, `medium` = probable, `low` = estimation à vérifier.
- Le bac n'apparaît jamais dans le JSON : l'utilisateur le choisit à l'import.
- `capturedAt` seulement si la date est connue (métadonnées ou indiquée par l'utilisateur).
- Textes en français.

## 3. `inventory`

- Un élément par espèce, pas par individu.
- `scientificName` en binôme latin. Privilégie **les noms de `catalogue.md`** quand l'espèce y figure, écrits exactement pareil. Sinon : nom scientifique courant, ou « Genre sp. » si seul le genre est reconnaissable.
- **Plantes à égalité avec les animaux** : liste toutes les plantes identifiables, mousses et flottantes comprises.
- Unités : `individual` pour les animaux ; pour les plantes, `stem` (plante à tiges, compter les tiges), `rosette` (Cryptocoryne, Echinodorus, flottantes), `pot` (Anubias, fougères, Bucephalandra fixées), `portion` (mousses, gazons), `cm2` pour un tapis étendu.
- Animaux partiellement visibles ou en banc : estime et mets `quantityIsEstimate: true`.
- Les escargots et crevettes sont souvent peu visibles : mentionne-le dans `warnings` plutôt que de sous-compter en silence.

## 4. `water_test` (tests en gouttes)

- `method`: `"drops"` pour les tests en gouttes.
- Compare la couleur de chaque tube au **nuancier visible sur la photo**. Si le nuancier n'est pas visible, utilise le nuancier standard de la marque reconnue et baisse la confiance d'un cran.
- Valeur entre deux cases du nuancier : prends la plus proche, `confidence: "low"` ou `"medium"`, et écris l'encadrement dans `note` (ex. « entre 10 et 25 »).
- GH et KH en gouttes se lisent au **nombre de gouttes** jusqu'au virage : si l'utilisateur donne le nombre de gouttes, utilise-le (1 goutte ≈ 1 °d pour la plupart des marques, à préciser dans `note`).
- Unités attendues : `temp` en °C, `gh`/`kh` en °d, `no2`/`no3`/`nh4`/`po4`/`fe`/`k`/`mg`/`co2` en mg/L, `conductivity` en µS/cm.
- Éclairage jaune, reflets, tube incliné : signale-le dans `warnings`.
- Identifie chaque tube par son étiquette ou sa position annoncée par l'utilisateur. En cas de doute sur quel tube correspond à quel test, ne devine pas : omets la valeur et explique.

## 5. `sanity` (bilan visuel)

Passe en revue, dans cet ordre :
1. **Algues** : filamenteuses, barbe noire (BBA), diatomées brunes, cyanobactéries (nappe verte bleutée gluante), points verts sur les vitres, eau verte.
2. **Poissons** : points blancs (Ichthyophthirius), voile blanchâtre, nageoires effilochées, ventre gonflé, écailles hérissées, respiration en surface, couleurs ternes, maigreur.
3. **Invertébrés** : crevettes blanchâtres ou mortes, mues ratées, coquilles d'escargots abîmées ou creusées (eau trop douce).
4. **Plantes** : feuilles jaunes (azote ou fer), nervures vertes sur limbe jaune (fer), trous (potassium), pointes blanches ou déformées (calcium), fonte, feuilles couvertes d'algues.
5. **Eau** : trouble blanc (bactéries), verte, jaune ou ambrée (tanins, normal avec du bois), film en surface.
6. **Matériel et décor** : filtre colmaté visible, sol tassé ou noir, débris, nourriture non consommée.

Pour chaque constat : `category`, `severity` (`info` = à noter, `warn` = à traiter, `danger` = urgent pour la vie des animaux), un `title` court, le `detail`, la `likelyCause`, et 1 à 3 conseils concrets dans `advice`. Mets `scientificName` quand une espèce précise est concernée.

`overall` : `good` si rien au-delà de `info`, `watch` si au moins un `warn`, `problem` si au moins un `danger`. Un bac sain mérite aussi un `findings` (même vide) et un `summary` positif.

Les diagnostics de maladie sont des **hypothèses** : `confidence` rarement `high`, et le conseil d'observer de près avant de traiter.

## 6. Exemples

```json
{
  "format": "my-aquarium-ai",
  "version": 1,
  "kind": "inventory",
  "source": { "photo": "Vue de face d'un bac planté de 60 L" },
  "data": {
    "items": [
      { "scientificName": "Danio margaritatus", "commonName": "Rasbora galaxy", "kind": "fish", "quantity": 10, "quantityIsEstimate": true, "unit": "individual", "confidence": "high" },
      { "scientificName": "Rotala rotundifolia", "commonName": "Rotala", "kind": "plant", "quantity": 12, "unit": "stem", "confidence": "medium" },
      { "scientificName": "Taxiphyllum barbieri", "commonName": "Mousse de Java", "kind": "plant", "quantity": 2, "unit": "portion", "confidence": "medium", "note": "Sur la racine à gauche" }
    ]
  },
  "warnings": ["Les crevettes sont probablement cachées dans la mousse : aucune n'est comptée."]
}
```

```json
{
  "format": "my-aquarium-ai",
  "version": 1,
  "kind": "water_test",
  "source": { "photo": "Trois tubes JBL devant le nuancier" },
  "data": {
    "method": "drops",
    "testKit": "JBL ProAquaTest",
    "values": {
      "ph": { "value": 7.2, "confidence": "high" },
      "no2": { "value": 0, "confidence": "high" },
      "no3": { "value": 25, "confidence": "low", "note": "entre 10 et 25 sur le nuancier" }
    }
  },
  "warnings": ["Lumière chaude : les jaunes paraissent plus orangés."]
}
```

```json
{
  "format": "my-aquarium-ai",
  "version": 1,
  "kind": "sanity",
  "data": {
    "overall": "watch",
    "summary": "Bac globalement sain, mais des algues filamenteuses s'installent sur les plantes à tiges.",
    "findings": [
      {
        "category": "algae",
        "severity": "warn",
        "title": "Algues filamenteuses sur la Rotala",
        "detail": "Filaments verts accrochés aux têtes des tiges, côté droit.",
        "scientificName": "Rotala rotundifolia",
        "likelyCause": "Éclairage long ou déséquilibre entre lumière et nutriments.",
        "advice": ["Retirer les filaments à la main", "Réduire la photopériode à 7 h", "Ajouter des crevettes Amano"],
        "confidence": "medium"
      }
    ]
  }
}
```
