# Fixtures OCR partagées — source de vérité des 3 parsers

Le parsing d'écran (texte OCR → `{ platform, fare, distanceKm, … }`) est
implémenté **3 fois** : `src/services/scanner/ocrParser.ts` (TS),
`ios/Strive/Scanner/OcrParser.swift` (iOS) et
`android/.../scanner/OcrParser.kt` (Android). Ces JSON sont le contrat commun :
**les trois implémentations doivent produire `expected` pour chaque cas.**

Règle d'or : tout fix de parser commence par une fixture ici. Tant qu'une
plateforme ne passe pas la fixture, le fix n'est pas terminé.

## Format

Chaque fichier est un tableau de cas :

```json
{
  "name": "slug-unique-du-cas",
  "description": "contexte (optionnel)",
  "screenHeight": 1920,
  "blocks": [ { "text": "…", "x": 50, "y": 200, "width": 200, "height": 40 } ],
  "expected": { … } | null
}
```

- `expected: null` → le parse doit échouer (retour null / nil).
- `expected.platform` / `fare` / `distanceKm` : toujours assertés.
- `expected.durationMin` : asserté seulement si la clé est présente
  (`null` = doit être absent/null).
- `expected.pickupAddressContains` / `destinationAddressContains` :
  sous-chaîne attendue dans l'adresse ; `null` = l'adresse doit être absente ;
  clé omise = non assertée.
- `expected.pickupDistanceKm` / `pickupDurationMin` : assertés si présents.

## Runners

- **TS** : `src/services/scanner/__tests__/ocrParser.fixtures.test.ts` (Jest, en CI)
- **Swift** : à brancher (XCTest lisant ce dossier) — Phase 3
- **Kotlin** : à brancher (JUnit lisant ce dossier) — Phase 2

## Décisions canoniques actées

- `fare-ocr.json#single-digit-whole-euro-rejected` : un montant entier à
  1 chiffre ("5€") n'est PAS un tarif (bruit : pourboire, pack, note).
  → Swift doit s'aligner : son `priceWholeRegex` accepte `\d{1,6}`,
  le contrat exige `\d{2,6}`.
