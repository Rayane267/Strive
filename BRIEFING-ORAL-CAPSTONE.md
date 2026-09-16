# Strive — dossier de compréhension totale

> **À quoi sert ce fichier.** Il est écrit pour être donné à un assistant IA (Claude) qui
> n'a **jamais vu le code** de Strive, afin qu'il puisse aider à préparer la **soutenance
> orale du Professional Capstone** (PST&B, M2 Data Science in Business, 2025-2026).
> Tout ce qui suit est extrait du dépôt réel, pas d'une brochure marketing.
> Dernière mise à jour : **7 septembre 2026** (données mesurées en base ce jour) · branche `strive-vert` · 221 commits.

---

## 0. Mode d'emploi pour l'assistant

**Strive est un projet de startup réel**, développé sur 6,5 mois, aujourd'hui en bêta chez
de vrais chauffeurs. Il est présenté à l'oral dans un cadre scolaire (§21), mais ce n'est
pas un exercice d'école : c'est un produit, avec des utilisateurs, un modèle économique et
des contraintes de coût.

Si tu lis ce fichier, tu es probablement sollicité pour :

1. **Construire le support de présentation** (15 min).
2. **Préparer la défense orale** : simuler les questions, critiquer les réponses.
3. **Traduire la technique en langage décideur** — le public est mixte (management +
   data), pas une équipe d'ingénierie. Chaque détail technique doit se ramener à une
   décision, un arbitrage, un coût ou un risque.
4. **Rédiger** des parties du dossier écrit.

**Règles à respecter dans tes réponses :**

- **Il y a de la vraie donnée.** Des bêta-testeurs utilisent l'app et la base contient des
  courses réelles. C'est le matériau le plus fort du projet : **2 943 courses réelles** mesurées sur
  2 mois (cohorte 50+), analysées au §18. Ne jamais présenter le projet comme une maquette.
- **Mais ne jamais inventer un chiffre.** Ni nombre d'utilisateurs, ni CA, ni taux de
  conversion, ni taux de détection. Les chiffres de code sont au §17 ; les chiffres
  d'usage doivent sortir des requêtes du §18, lancées pour de vrai. Un chiffre non mesuré
  se dit « non mesuré ».
- **Parler produit et décision avant de parler technologie.** La liste des outils (§16)
  n'impressionne personne seule ; ce qui tient, ce sont les arbitrages (§6, §11).

---

## 1. Le pitch

### En une phrase

> Strive dit à un chauffeur VTC, en deux secondes et sans quitter son application Uber, si
> la course qu'on lui propose est **réellement** rentable — €/h et €/km nets de carburant,
> trajet d'approche et trafic compris.

### En trente secondes

Un chauffeur VTC reçoit une offre et a quelques secondes pour l'accepter. L'écran lui
montre un prix. Il ne lui montre ni le taux horaire réel, ni le coût du carburant, ni
l'effet du trajet d'approche — donc jamais la rentabilité. Strive lit l'écran, calcule, et
affiche un verdict vert/orange/rouge par-dessus l'application VTC, selon les seuils que le
chauffeur a lui-même fixés. Puis il historise tout : revenus consolidés multi-plateformes,
meilleurs créneaux horaires, discipline de tri.

### En deux minutes (structure de pitch)

| Temps | Contenu |
|---|---|
| Le problème | Décision en quelques secondes, sur une information volontairement incomplète |
| Le verrou | Aucune API. La donnée existe, elle est **enfermée dans une image**, quelques secondes |
| La solution | Chaîne d'extraction embarquée : OCR natif → parsing → repli LLM → enrichissement trafic → verdict |
| La preuve | 2 943 offres réelles scannées en 2 mois, chaîne opérationnelle sur iOS et Android (§18) |
| Le modèle | Freemium 3 paliers + packs de scans, coût variable maîtrisé par cascade et coupe-circuit (§11) |
| Ce qui protège | La difficulté n'est pas le calcul, c'est l'extraction fiable sans API — et elle est instrumentée (§6, §12) |

### Marché et positionnement

- **Cible** : chauffeurs VTC indépendants, marché initial la France (Uber, Bolt, Heetch),
  extension européenne déjà préparée côté technique — détection d'adresse en 6 langues,
  itinéraires TomTom sur 13 pays.
- **Ce que font les alternatives** : les tableurs personnels et les applications de suivi
  de revenus travaillent **a posteriori**, après la course, à partir de saisies manuelles
  ou de relevés. Strive intervient **avant la décision**, au moment où elle a de la valeur.
- **Ce qui se défend comme avantage** : pas le calcul d'un €/h, qui est une division ;
  mais la chaîne d'extraction — cascade de coût, bornes de plausibilité qui détectent leurs
  propres erreurs, remote config pour patcher sans passer par les stores, télémétrie qui
  rend une dégradation visible avant que le support ne la remonte.
- **Risque principal, nommé** : dépendance à l'interface d'un tiers qui peut changer du
  jour au lendemain. Il n'est pas supprimé, il est **instrumenté** (§19).

### Ce qui n'est pas encore prouvé

Pas de publication sur les stores, donc pas de conversion payante mesurée, pas de coût
d'acquisition, pas de rétention long terme. Le bêta prouve que **la chaîne technique tient
en conditions réelles** ; il ne prouve pas encore le marché. Dire les deux.
## 2. Le problème

Un chauffeur VTC (Uber, Bolt, Heetch) reçoit une offre de course sur son téléphone. Il a
**quelques secondes** pour accepter ou refuser. L'écran lui montre un prix, parfois une
distance, parfois une durée, parfois des adresses. Il ne lui montre **jamais** :

- le **taux horaire réel** de la course (€/h), une fois le trajet d'approche compté ;
- le **taux au kilomètre réel** (€/km) sur la distance réellement parcourue ;
- le **coût carburant** de la course, donc la **marge nette** ;
- l'effet du **trafic réel** sur la durée annoncée.

Conséquences observables :

- Le chauffeur arbitre à l'intuition, sur un prix affiché qui ne dit rien de la rentabilité.
- Il n'a **aucun historique consolidé multi-plateformes** : ses données vivent dans trois
  applications qui n'exportent rien d'exploitable.
- Il ne sait pas **quand** il gagne réellement le mieux (créneaux horaires), seulement
  quand son téléphone sonne le plus — deux choses différentes.

**Verrou central, et c'est lui qui fait le sujet data :** les plateformes n'exposent
**aucune API** au chauffeur. La donnée existe, elle est affichée, mais elle est
**enfermée dans une image**, sur un écran, pendant quelques secondes. Toute la chaîne de
valeur du projet consiste à **transformer un pixel en donnée structurée, fiable et
datée**, puis à en faire un actif analytique.

---

## 3. Ce que fait Strive

Application mobile **iOS et Android** pour chauffeurs VTC. Quatre promesses :

1. **Scanner** l'écran d'offre en un geste, sans quitter l'app VTC, et en extraire prix,
   distance, durée, adresses.
2. **Calculer la rentabilité réelle** : €/h, €/km, coût carburant, profit net, et rendre
   un **verdict à trois niveaux** (vert « prendre » / orange « peut-être » / rouge
   « refuser ») en fonction de **seuils personnels** définis par le chauffeur.
3. **Historiser et analyser** : historique des courses, revenus, meilleurs créneaux
   horaires, score de qualité et de discipline.
4. **Gérer son activité** : profil, véhicule et consommation, préférences, abonnement.

### Le verdict en trois couleurs — le cœur produit

Le chauffeur règle deux seuils dans ses préférences : un **€/h minimum** et un **€/km
minimum**. Pour chaque course :

- **les deux seuils dépassés → vert** (prendre) ;
- **un seul des deux → orange** (à vous de décider) ;
- **aucun des deux → rouge** (éviter).

Ce verdict est calculé au scan, affiché immédiatement, et **rejoué a posteriori** dans les
statistiques (`qualityScore.ts`) pour mesurer non seulement la qualité des courses prises,
mais aussi la **discipline** du chauffeur : a-t-il pris les vertes et refusé les rouges ?
L'orange est exclu de ce calcul, parce qu'un arbitrage y est légitime dans les deux sens.

### Où le verdict s'affiche (c'est un point de design important)

Le chauffeur **ne doit pas quitter l'application Uber/Bolt** pendant qu'il regarde
l'offre. Donc Strive ne s'ouvre pas :

- **iOS** : le verdict arrive dans la **Dynamic Island / Live Activity**, par-dessus l'app
  VTC, plus une notification actionnable (boutons « Prise » / « Refusée »).
- **Android** : une **bulle flottante** en surimpression affiche le verdict, le tarif, la
  distance, la durée, le €/h et le €/km.
- **CarPlay** : un tableau de bord en lecture seule, **quatre lignes maximum**, €/h en
  tête — au volant, une donnée qu'on doit chercher est une donnée qu'on ne lit pas.

---

## 4. Les parcours utilisateur

### Déclenchement du scan — iOS

L'utilisateur installe **un raccourci** (app Raccourcis d'Apple) fourni par Strive. Ce
raccourci enchaîne « prendre une capture d'écran » → « analyser une course avec Strive »
(un **App Intent** exposé par l'app). Il peut être déclenché par :

- **AssistiveTouch** (bouton flottant système) — voie recommandée, la plus rapide ;
- **Toucher l'arrière** (double tape au dos du téléphone) ;
- le widget Raccourcis ou Siri.

L'intent tourne **en arrière-plan** (`openAppWhenRun = false`, volontaire) : l'app ne
passe jamais au premier plan, le chauffeur ne perd pas l'offre de vue. C'est un
`LiveActivityIntent`, protocole précisément prévu pour piloter une Live Activity sans
passer au premier plan.

> Note : le tutoriel iOS a été refondu (9 → 6 slides). Le flux « Share Sheet / Share
> Extension » que certains commentaires du code mentionnent encore est **périmé** — la
> vérité du parcours iOS est dans `ios/Strive/AppIntents/AnalyzeRideIntent.swift` et dans
> les clés de traduction `tutorial.*`.

### Déclenchement du scan — Android

L'utilisateur active le scanner depuis l'accueil, accorde deux permissions
(**service d'accessibilité** + **affichage par-dessus les autres applications**), et une
**bulle flottante** s'installe. Quand une offre s'affiche, il **tape sur la bulle** :
capture d'écran + analyse + verdict directement dans la bulle.

La capture utilise `AccessibilityService.takeScreenshot()` sur **Android 11+**, et retombe
sur **MediaProjection** en dessous.

### Boucle de valeur complète (les deux plateformes)

```
1. Offre affichée dans Uber/Bolt/Heetch
2. Déclenchement (AssistiveTouch iOS / bulle Android)
3. Capture d'écran → OCR → parsing → verdict provisoire  (affiché immédiatement)
4. En arrière-plan : TomTom (géocodage + itinéraire) → verdict affiné, trafic inclus
5. Le chauffeur tape « Prise » ou « Refusée » — depuis la notification, la Live Activity
   ou la bulle, sans ouvrir l'app
6. La course est écrite en base (avec son coût carburant figé au moment du scan)
7. Elle alimente l'historique, les analytics, les meilleurs créneaux, le score qualité
```

L'étape 5 est stratégique : **c'est le tag qui transforme un scan en donnée exploitable**.
Une course non taguée reste `PENDING` et fausse les statistiques. D'où une relance
automatique par notification (« Tague tes courses ») déclenchée par cron dès qu'un
chauffeur cumule 5 courses non taguées.

### Les 21 écrans

| Écran | Rôle |
|---|---|
| `AuthScreen` | Connexion / inscription — email, Google, Apple |
| `OnboardingScreen`, `TutorialScreen` | Première utilisation, installation du raccourci / des permissions |
| `ProfileSetupScreen` | Renseignement du profil chauffeur |
| `WelcomeGiftScreen` | Attribution des 30 scans de bienvenue |
| `DashboardScreen` | Écran principal : état de session, gain du jour, scan |
| `AnalyticsScreen` | Revenus, KPI, graphiques, meilleurs créneaux, score qualité |
| `BestHoursScreen` | Grille 7 × 24 des créneaux : où ça sonne, où ça paie |
| `HistoryScreen` | Historique des courses, tag a posteriori |
| `ProfileScreen`, `AccountInfoScreen` | Compte, suppression de compte, effacement d'historique |
| `CarSettingsScreen` | Véhicule : marque, modèle, carburant, consommation, prix €/kWh |
| `PreferencesScreen` | Seuils €/h et €/km, heure de reset de journée, langue, notifications |
| `SubscriptionScreen`, `ShopScreen` | Abonnements et packs de scans |
| `SupportTicketsScreen`, `SupportTicketDetailScreen` | Support intégré (tickets + messages) |
| `HelpScreen` | Aide, FAQ |
| `ScannerPermissionScreen` | Guidage des permissions natives |
| `ResetPasswordScreen` | Réinitialisation de mot de passe |
| `DiagnosticsScreen` | Diagnostic technique (support, débogage terrain) |

---

## 5. Architecture générale

```
┌───────────────────────────────────────────────────────────────────────┐
│  TÉLÉPHONE                                                            │
│                                                                       │
│  ┌──── Couche native ─────────────────┐   ┌──── Couche React Native ─┐ │
│  │ iOS (Swift)      Android (Kotlin)  │   │  TypeScript / React 19   │ │
│  │ • Vision OCR     • ML Kit OCR      │   │  • 21 écrans             │ │
│  │ • OcrParser.swift• OcrParser.kt    │◄─►│  • 19 services métier    │ │
│  │ • App Intents    • Bulle flottante │   │  • ocrParser.ts (réf.)   │ │
│  │ • Live Activity  • Accessibility   │bridge  • cache offline       │ │
│  │ • CarPlay        • MediaProjection │   │  • i18n fr/en            │ │
│  │ • TomTomService  • TomTomService   │   │                          │ │
│  └────────────────────────────────────┘   └──────────────────────────┘ │
└──────────────────┬──────────────────────────────────┬─────────────────┘
                   │                                  │
      ┌────────────▼────────────┐        ┌────────────▼─────────────────┐
      │  SUPABASE               │        │  SERVICES TIERS              │
      │  • Auth (JWT)           │        │  • TomTom (geocode+routing)  │
      │  • PostgreSQL + RLS     │        │  • RevenueCat (abonnements)  │
      │  • 6 Edge Functions     │───────►│  • Google Gemini 2.5 Flash   │
      │  • pg_cron (purges,     │        │  • Firebase FCM (push)       │
      │    relances)            │        │  • Sentry (monitoring)       │
      │  • 54 migrations SQL    │        │  • Apple / Google Sign-In    │
      └─────────────────────────┘        └──────────────────────────────┘
```

### Principes d'architecture assumés (matière à défendre à l'oral)

1. **Le calcul lourd vit en natif, la logique métier vit en un seul endroit.**
   L'OCR est natif pour la performance (Vision sur iOS, ML Kit sur Android), mais la
   *règle d'interprétation* est un contrat unique — voir §6 et §12 sur les fixtures.
2. **Le serveur tranche, le client optimise.**
   Le compteur de quota local est un cache **permissif** : laisser passer un scan de trop
   coûte un scan ; bloquer un scan légitime immobilise un chauffeur qui paie. Le serveur
   arbitre (trigger `enforce_scan_quota`), le client ne fait qu'anticiper.
3. **Aucun secret exploitable dans le bundle client.**
   La clé Gemini n'existe que côté serveur, derrière une edge function authentifiée.
4. **Isolation des pannes.**
   Chaque écran est enveloppé dans son propre `ErrorBoundary` : un crash local ne fait
   pas tomber l'application.
5. **Remote config.**
   Les paramètres de parsing (ancres de prix, bornes de plausibilité) sont patchables
   depuis Supabase **sans republier sur les stores** — délai de correction de plusieurs
   jours ramené à quelques minutes.
6. **Fail-closed sur ce qui coûte de l'argent.**
   Si la base est injoignable, le proxy Gemini **refuse** l'appel plutôt que de laisser le
   compteur de coût sans garde-fou.
7. **Privacy by design.**
   La capture d'écran est traitée **100 % en mémoire**, jamais persistée sur disque.

---

## 6. Le cœur technique : le pipeline de scan

C'est la partie la plus riche du projet, et probablement le centre de gravité de la présentation.

### Vue d'ensemble

```
Capture d'écran (en mémoire, jamais écrite sur disque)
        │
        ▼
[1] OCR NATIF ──────────────────────────────────────────────── gratuit, hors-ligne, ~200 ms
    iOS : Vision framework        Android : ML Kit Text Recognition
    → liste de TextBlocks : { text, x, y, width, height }
        │
        ▼
[2] PARSING SÉMANTIQUE ─────────────────────────────────────── gratuit, déterministe
    OcrParser (Swift / Kotlin / TypeScript, même contrat)
    a. Identification de la plateforme
    b. Extraction du tarif
    c. Extraction distance / durée
    d. Extraction des adresses départ / destination
    e. Contrôles de plausibilité (sanity bounds)
        │
        ├── succès ──────────────► verdict provisoire affiché IMMÉDIATEMENT
        │                          (Live Activity iOS / bulle Android)
        │
        └── échec ou valeurs aberrantes
                │
                ▼
[3] REPLI LLM ──────────────────────────────────────────────── payant, ~2-8 s, en ligne
    Image compressée → Edge Function `gemini-proxy` → Gemini 2.5 Flash
    Prompt métier strict → JSON structuré → re-validation
        │
        ▼
[4] ENRICHISSEMENT TOMTOM ────────────────────────────────────  en arrière-plan, ~1-4 s
    Géocodage des deux adresses → calcul d'itinéraire avec trafic
    → distance et durée RÉELLES, qui remplacent celles lues à l'écran
    → si TomTom échoue : on garde les valeurs OCR (dégradation gracieuse)
        │
        ▼
[5] COÛT CARBURANT ET VERDICT FINAL
    prix unitaire (table `fuel_prices` ou repli) × consommation du véhicule × distance
    → fuel_cost et net_profit FIGÉS dans la course (dataset daté, reproductible)
        │
        ▼
[6] ÉCRITURE — course en base + télémétrie non nominative + décision du chauffeur
```

### [1] et [2] — pourquoi un parser écrit trois fois

Il existe **trois implémentations** du même parser :
`src/services/scanner/ocrParser.ts` (647 lignes),
`ios/Strive/Scanner/OcrParser.swift` (950 lignes),
`android/.../scanner/OcrParser.kt` (1041 lignes).

C'est un **arbitrage assumé, pas un accident** : le scan doit tourner en arrière-plan,
dans un processus natif, sans que le moteur JavaScript de React Native soit démarré —
sinon on paie le réveil du bundle JS sur chaque scan, ce qui est incompatible avec les
quelques secondes dont dispose le chauffeur. Le prix payé, c'est une **duplication de
logique** ; le garde-fou, ce sont les **fixtures partagées** (§12), qui font office de
contrat exécutable entre les trois implémentations.

### Les difficultés réellement traitées par le parser (à citer, ce sont les meilleures anecdotes)

| Problème rencontré | Traitement |
|---|---|
| L'OCR insère des espaces parasites : `17 , 18 €`, `11 . 8 km` | Les regex tolèrent les espaces autour du séparateur décimal |
| Uber en mode sombre n'affiche **pas** le mot « Uber » | Détection par tournures : « exclusivité », « montant net », « net de frais », et par catégories exclusives (`uberx`, `berline`, `comfort electric`) |
| Une ligne statistique (« Course de 11,8 km ») ressemble à une adresse | Détection d'adresse par mots-clés de voie en **6 langues** (FR, EN, ES, IT, NL, PT) + POI (gare, aéroport, hôpital, `bahnhof`, `estación`, `stazione`…) |
| Sur une offre véhicule électrique, Uber affiche une info de recharge (« 35 min », « 250 km ») qui n'a rien à voir avec la course | Filtre de contexte EV (`autonomie`, `recharg`, `borne`, `kWh`, `battery`…). Piège : le mot « charge » seul est **proscrit**, parce que « prise en charge » désigne le pickup et apparaît sur presque toutes les offres |
| L'app Uber FR écrit l'approche « 11 min (à 2,6 km) » | Le séparateur de la regex d'approche a dû accepter des **lettres** : sans ça, l'approche n'était jamais reconnue, et ses km/min ne rentraient pas dans le total — donc un €/h et un €/km systématiquement faux, sans aucun signal d'erreur |
| Un montant à un seul chiffre (« 5 € ») est du bruit (pourboire, note) | Décision canonique actée en fixture : ce n'est **pas** un tarif |
| Le texte est coupé entre plusieurs blocs OCR | Recollage (« stitching ») de blocs voisins, avec fixtures dédiées |

### Bornes de plausibilité (« sanity bounds »)

Valeurs par défaut, identiques dans les trois parsers, **patchables à distance** :

| Grandeur | Min | Max |
|---|---|---|
| Tarif | 8 € | 200 € |
| Distance | 0,3 km | 500 km |
| Taux (€/km) | 0,4 | 12 |

Une valeur hors bornes ne produit pas un résultat faux : elle **déclenche le repli LLM**.
C'est le mécanisme qui empêche une hallucination d'OCR d'atterrir silencieusement dans les
statistiques du chauffeur.

### [3] — le repli LLM et son économie

- Modèle : **Gemini 2.5 Flash**, appelé via
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`.
- **Jamais appelé directement depuis le téléphone** : tout passe par l'edge function
  `gemini-proxy`, qui porte la clé API et cinq couches de contrôle (détail §8).
- **C'est un repli, pas le mode nominal.** Le parsing local est gratuit, instantané et
  fonctionne hors-ligne ; le LLM coûte de l'argent, ajoute de la latence et exige du
  réseau. La télémétrie mesure explicitement le **taux de repli Gemini**, qui est traité
  comme un **indicateur de coût** autant que de qualité.
- Le client abandonne à **12 s** ; l'edge function coupe à **15 s** — tenir plus longtemps
  ne ferait que facturer du temps d'exécution pour une réponse que plus personne n'attend.

**C'est l'arbitrage central du projet** : coût × latence × précision × disponibilité
hors-ligne. Un pipeline « tout LLM » serait plus simple à écrire, plus robuste sur les cas
tordus, et économiquement intenable ; un pipeline « tout local » serait gratuit et
casserait à chaque refonte d'interface d'Uber. La réponse retenue est une **cascade**, où
la couche chère n'est sollicitée que lorsque la couche gratuite a échoué **et l'a détecté**.

### [4] — TomTom, ou pourquoi on ne fait pas confiance à l'écran

La distance affichée par la plateforme est souvent une distance à vol d'oiseau ou une
estimation sans trafic. Strive géocode les deux adresses puis calcule l'itinéraire réel
(`api.tomtom.com/search/2/geocode` puis `routing/1/calculateRoute`), sur 13 pays
européens, avec un **timeout de 4 s** et un score de confiance minimum de géocodage.

Un **cache de géocodage** (`GeocodeCache`, présent des deux côtés) évite de repayer la
même adresse. En cas d'échec, on **retombe sur les valeurs OCR** — dégradation gracieuse
plutôt qu'échec.

### [5] — le coût carburant, figé au scan

`fuelService.ts` résout le prix unitaire (table `fuel_prices`, région Paris, sinon repli),
le croise avec le type de carburant et la consommation moyenne du véhicule renseignés par
le chauffeur, et **écrit `fuel_cost` et `net_profit` dans la course**.

Le choix de figer plutôt que de recalculer est explicite : le prix du carburant change tous
les jours ; recalculer a posteriori produirait un historique qui bouge sous les pieds du
chauffeur. On garde un **dataset daté et reproductible**.

Prix de repli (moyennes France ~2026) : essence 1,85 €/L · diesel 1,80 €/L · E85 0,95 €/L ·
électrique 0,25 €/kWh (l'électrique n'a pas de source marché — recharge domicile/borne trop
variable — donc l'utilisateur peut saisir son propre `elec_price`).

---

## 7. Le modèle de données

15 tables PostgreSQL, 54 migrations versionnées, **40 policies RLS**.

### Tables métier

| Table | Contenu |
|---|---|
| `profiles` | Identité, statut en ligne, **abonnement** (palier, statut, expiration, produit), crédits, **quota journalier** (`daily_scans_count`, `daily_scans_day`), fuseau horaire, **véhicule** (marque, modèle, année, immatriculation, carburant, consommation, prix kWh) |
| `rides` | Plateforme, statut (`PENDING`/`ACCEPTED`/`DECLINED`), tarif estimé vs tarif final, distance, durée, €/h, €/km, `fuel_cost`, `net_profit`, adresses départ/destination, `scan_ts`, `created_at` |
| `preferences` | Seuils €/h et €/km, heure de reset de journée, langue préférée, réglages de notification |
| `fuel_prices` | Prix carburant par type et région |
| `subscription_products` | Catalogue des produits (source de vérité DB, miroir de RevenueCat) |
| `plan_limits` | Limites par palier (scans/jour, profondeur d'historique analytique) |

### Tables d'observation et de gouvernance (l'angle « infrastructure de données »)

| Table | Rôle |
|---|---|
| `scan_events` | **Télémétrie produit non nominative** : plateforme, nombre d'adresses trouvées (0/1/2), repli Gemini oui/non, source de la durée, verdict, **tranche** de tarif. Jamais le montant exact, jamais l'adresse, jamais de coordonnées |
| `scan_failures` | Trace des scans qui **n'aboutissent pas** — 12 motifs fermés (`ocr_empty`, `gemini_ko`, `quota_reached`, `timeout`, `la_start_failed`…) et 3 surfaces (`shortcut`, `share_ext`, `bubble`) |
| `scan_debug` | Captures de diagnostic bêta (blocs OCR bruts) — peut contenir des adresses, donc **purgé à 30 jours** par `pg_cron`, et l'utilisateur peut s'y soustraire |
| `audit_log` | Journal serveur — sert aussi de compteur au rate limiting Gemini |
| `device_signups` | Anti-abus multi-comptes |
| `welcome_grants` | Traçabilité des cadeaux de bienvenue |
| `processed_webhook_events` | **Idempotence** des webhooks RevenueCat |
| `support_tickets`, `support_messages` | Support intégré, avec priorité automatique |
| `waitlist` | Liste d'attente pré-lancement (site web) |
| `scan_ledger` | ⚠️ **Table morte** — supprimée par la migration du 22/08. Voir plus bas, l'histoire vaut d'être racontée |

### L'histoire du `scan_ledger` — l'anecdote de conception la plus parlante

**Le problème.** Le quota de scans se comptait sur la table `rides`. Or l'app expose
« Supprimer mon historique », que le RGPD **oblige** à proposer. Le compteur de quota et
les données supprimables étaient donc **la même chose** : trois scans, un appui sur le
bouton, trois scans de plus. À l'infini.

**Première tentative, écartée.** Une simple colonne compteur. Elle ne marchait pas : le
journal natif rejoue les scans qu'il n'a pas pu insérer, parfois des heures plus tard
(app fermée, réseau coupé). Un compteur s'incrémente à chaque rejeu — **un rejeu comptait
double**.

**Deuxième solution.** Une table-registre dont la clé *est le scan lui-même*
(`scan_ts`) : réinsérer le même scan ne fait rien. **L'idempotence par la clé plutôt que
par le compteur.**

**Troisième temps.** Une migration ultérieure a frappé l'identifiant de la course **au
moment du scan**, ce qui rendait le rejeu naturellement idempotent **en amont**. La seule
raison d'avoir une table d'événements disparaissait : le registre a été supprimé et son
contenu repris dans une colonne de `profiles`.

C'est une leçon d'architecture data pure : **on a payé une table entière pour obtenir une
propriété (l'idempotence) qu'on a ensuite obtenue plus haut dans la chaîne, gratuitement**.
Et le fichier de migration a été conservé, marqué caduc, parce qu'une migration jouée ne se
retire pas de l'historique.

### Fonctions et RPC PostgreSQL (34 fonctions)

Les plus significatives :

- `enforce_scan_quota` — **le trigger qui fait autorité sur le quota**. Ordre de
  consommation : quota journalier du palier → crédits de bienvenue (qui périment) →
  crédits achetés (qui ne périment jamais).
- `user_day_start`, `user_stats_today` — la « journée de travail » n'est pas la journée
  civile : elle démarre à une heure choisie par le chauffeur (`day_reset_hour`), dans
  **son** fuseau horaire. Un chauffeur de nuit ne doit pas voir sa journée coupée à minuit.
- `apply_revenuecat_event` — application idempotente d'un événement de facturation.
- `prevent_tier_tampering` — empêche un client d'élever son propre palier d'abonnement.
- `delete_account` — suppression de compte en cascade (RGPD, droit à l'effacement).
- `effective_tier` — palier réellement applicable, période de grâce comprise.
- `log_scan_event`, `log_scan_failure`, `log_scan_debug` — écriture de télémétrie en
  `SECURITY DEFINER` : **aucun client ne peut insérer une ligne arbitraire**.
- `join_waitlist`, `waitlist_count` — inscription publique sans exposer la table.
- `is_disposable_email`, `normalize_email`, `reject_disposable_email` — anti-abus.
- `purge_scan_debug`, `purge_scan_failures`, `purge_old_ride_addresses` — rétention.
- `skip_duplicate_ride` — déduplication sur `scan_ts`.

---

## 8. Le backend Supabase

### Les 6 Edge Functions (Deno / TypeScript)

| Function | Rôle |
|---|---|
| **`gemini-proxy`** | Proxy authentifié vers Gemini Vision — la pièce la plus durcie du projet |
| `revenuecat-webhook` | Synchronisation serveur de l'état d'abonnement (achat, renouvellement, expiration, remboursement), avec idempotence |
| `apple-revoke` | Révocation du jeton Apple à la suppression de compte (exigence Apple) |
| `fuel-prices` | Alimentation de la table des prix carburant |
| `notify-untagged` | Relance push « Tague tes courses » — déclenchée par `pg_cron`, envoi via **FCM HTTP v1** avec OAuth2 minté depuis un compte de service Google |
| `notify-ticket-reply` | Notification de réponse à un ticket de support |

### `gemini-proxy` en détail — l'exemple à montrer au jury

Cinq couches de contrôle, toutes justifiées :

1. **Authentification** — vérification du JWT Supabase côté fonction, en plus du
   `verify_jwt` de la plateforme (**défense en profondeur**). La clé anonyme seule est
   explicitement refusée.
2. **Rate limit utilisateur** — 60 appels/heure par `auth.uid()`, compté dans `audit_log`.
3. **Circuit breaker de coût** — plafond **global** de 2 000 appels par 24 h glissantes,
   tous utilisateurs confondus, ajustable par secret **sans redéploiement**.
   Le raisonnement est écrit dans le code : *le rate limit par utilisateur ne suffit pas —
   100 comptes gratuits, c'est 6 000 appels par heure.*
4. **Plafond de charge utile** — 2 Mo en dur (image base64 ≈ 1,4 Mo max), vérifié sur
   l'en-tête **et** sur le corps réellement lu.
5. **Validation structurelle** du payload + **CORS restreint**.

Et deux principes :

- **Fail-closed** : si la base est injoignable, on **refuse**. Gemini n'est qu'un repli de
  l'OCR local — mieux vaut le perdre temporairement que de laisser le compteur de coûts
  sans garde-fou.
- **Pas de fuite d'infrastructure** : l'erreur brute (URL amont, pile Deno) reste dans les
  logs, le client reçoit un code générique.

### Tâches planifiées (`pg_cron`)

- Purge de `scan_debug` à 30 jours (tous les jours à 03h45).
- Purge de `scan_failures`.
- Purge des adresses de courses anciennes.
- Relance des courses non taguées.

---

## 9. Le natif iOS (Swift, ~7 900 lignes)

| Fichier | Lignes | Rôle |
|---|---|---|
| `AppIntents/AnalyzeRideIntent.swift` | 949 | L'App Intent exposé à l'app Raccourcis — point d'entrée du scan |
| `ScanBridge/ScanBridgeModule.swift` | 933 | Pont natif ↔ JavaScript |
| `Scanner/OcrParser.swift` | 950 | Parser sémantique |
| `Scanner/ScanProcessor.swift` | 616 | Orchestration OCR → parsing → Live Activity → TomTom |
| `ScanBridge/GeminiVisionService.swift` | 297 | Appel du repli LLM depuis le natif |
| `Scanner/TomTomService.swift` | 206 | Géocodage + itinéraire |
| `ScanBridge/VisionOCRService.swift` | 153 | OCR Vision |
| `LiveActivity/` | — | Live Activity / Dynamic Island |
| `CarPlay/CarPlaySceneDelegate.swift` | — | Tableau de bord CarPlay, lecture seule |

### Problèmes de concurrence réellement traités (excellent matériau technique)

- **`OnceContinuation`** — une continuation Swift ne peut être reprise qu'une fois ; deux
  `resume` font **crasher le processus**. Or `performExpiringActivity` rappelle son bloc à
  l'expiration alors que le pipeline peut encore aboutir, et le watchdog de 25 s peut se
  déclencher juste après un callback. D'où une enveloppe qui garantit une reprise unique,
  et qui encaisse même une reprise arrivée *avant* l'attachement.
- **Anti double-tap cross-process** — chaque scan tourne dans **son propre processus**
  (App Intent, extension). Un simple booléen « scan en cours » n'est donc pas partagé. La
  sérialisation passe par un horodatage dans l'**App Group**, avec deux garde-fous : un
  verrou de 30 s (le pipeline dure 5 à 20 s ; sans lui, un second appui lançait un
  pipeline complet en parallèle — **deux appels payants, deux courses, pour une seule
  offre**) et un cooldown de 3 s contre le double appui.
- **`LiveActivityManager`** — un singleton touché depuis **quatre contextes d'exécution
  concurrents** (queue du bridge RN, main thread, thread de fond de l'intent, tâches
  d'observation). Sans synchronisation, l'app pilotait une carte qui n'était plus celle
  affichée : verdict qui ne s'affiche pas, carte fantôme.
- **Depuis l'arrière-plan, `Activity.request()` est interdit** par iOS : si aucune carte
  ne tourne, la mise à jour échoue et on bascule sur une notification.

### Codes d'erreur opaques

Chaque motif d'échec a un code hexadécimal stable de la forme `0xC0FEnnnn`
(`quota_reached` = `0xC0FE0342`, etc.). Choix documenté : le message explique le problème
en clair, le code ne sert que de **référence support** et ne révèle rien de l'interne ;
l'hexadécimal écarte les confusions O/0 et I/L/1 à la recopie ; et ces valeurs sont un
**contrat public** — un code n'est jamais réaffecté à un autre motif.

---

## 10. Le natif Android (Kotlin, ~3 800 lignes)

| Fichier | Lignes | Rôle |
|---|---|---|
| `FloatingBubbleService.kt` | 1254 | Bulle flottante : UI en surimpression, animations, verdict, compte à rebours |
| `OcrParser.kt` | 1041 | Parser sémantique (référence des trois implémentations) |
| `ScanBridgeModule.kt` | 725 | Pont natif ↔ JavaScript |
| `GeminiVisionService.kt` | 239 | Repli LLM |
| `TomTomService.kt` | 200 | Géocodage + itinéraire |
| `StriveAccessibilityService.kt` | 116 | Capture d'écran (Accessibility ≥ Android 11, MediaProjection en dessous) |
| `RideDecisionReceiver.kt` | 44 | Réception des décisions « Prise / Refusée » depuis la notification |
| `GeocodeCache.kt` | 113 | Cache de géocodage |

OCR : **ML Kit Text Recognition** (`com.google.mlkit.vision.text`), modèle latin.

---

## 11. Modèle économique et anti-abus

### Les trois paliers

| Palier | Scans / jour | Profondeur analytique | Seuils personnalisables |
|---|---|---|---|
| **Free** | 3 | 1 jour | Non (seuils imposés) |
| **Plus** | 30 | 7 jours | Oui |
| **Premium** | illimité | illimitée | Oui |

### Produits (RevenueCat)

- Abonnements : `strive_plus_monthly`, `strive_plus_yearly`, `strive_premium_monthly`,
  `strive_premium_yearly`.
- Consommables (packs de scans) : `strive_scan_pack_xs` (1), `_s` (3), `_m` (5), `_l` (10).
- Entitlements RevenueCat : `plus`, `premium`.
- **La base de données est la source de vérité finale** : le webhook RevenueCat met à jour
  `profiles` après lookup dans `subscription_products`. Le client ne décide jamais de son
  propre palier (trigger `prevent_tier_tampering`).

### Les trois natures de crédit — et pourquoi elles sont séparées

1. **Quota journalier** du palier — se réinitialise à l'heure de reset, dans le fuseau du
   chauffeur.
2. **Crédits de bienvenue** — 30 scans offerts une fois par appareil à la sortie de
   l'onboarding. Ils **périment**.
3. **Crédits achetés** (`extra_scan_credits`) — ils **ne périment jamais**.

D'où l'ordre de consommation imposé par `enforce_scan_quota` : quota → bienvenue →
achetés. On brûle toujours en premier ce qui a une date de péremption.

### Anti-abus : quatre couches contre la création de comptes en chaîne

Le risque est direct : 3 scans gratuits par jour × N comptes jetables = service gratuit
illimité, et facture Gemini pour l'éditeur.

1. **Blocklist de domaines jetables** (yopmail, mailinator, tempmail, guerrillamail,
   10minutemail, throwaway…).
2. **Email normalisé et unique** — neutralise les alias Gmail
   (`john.doe` = `johndoe` = `john+x`).
3. **Quota d'inscriptions par identité / par appareil** (5, resserré au fil des migrations).
4. **Cooldown de 60 s** entre l'inscription et le premier scan.

Plus, côté serveur, le **circuit breaker global** de `gemini-proxy` (§8) qui plafonne la
facture quoi qu'il arrive.

### Statuts d'abonnement gérés

`active`, `in_grace_period`, `expired`, `cancelled`, `paused`, `refunded` — avec gestion
explicite de la **période de grâce de facturation**, du **remboursement** et de la
**révocation en cas de transfert d'abonnement**.

---

## 12. Qualité, tests, observabilité

### Les fixtures OCR — le dispositif le plus intéressant méthodologiquement

`fixtures/ocr/` contient des cas de test en JSON : blocs OCR bruts en entrée, résultat
attendu en sortie. Ils sont le **contrat commun aux trois parsers** (TypeScript, Swift,
Kotlin).

```json
{
  "name": "uber-approach-longer-than-ride",
  "screenHeight": 1920,
  "blocks": [ { "text": "11 min (à 2,6 km)", "x": 50, "y": 200, "width": 200, "height": 40 } ],
  "expected": { "platform": "UBER", "fare": 17.18, "distanceKm": 11.8 }
}
```

Quatre fichiers : `core.json`, `addresses.json`, `fare-ocr.json`, `stitching.json`.

**Règle d'or écrite dans le dépôt : tout correctif de parser commence par une fixture.
Tant qu'une plateforme ne passe pas la fixture, le correctif n'est pas terminé.**

Le runner TypeScript tourne en CI (Jest). Les runners Swift (XCTest) et Kotlin (JUnit) sont
**identifiés comme à brancher** — c'est une limite connue, à assumer telle quelle devant le
jury plutôt qu'à masquer (voir §19). Les décisions litigieuses sont **actées par écrit**
dans le README des fixtures, avec la divergence à corriger nommée précisément.

### Tests unitaires (Jest + React Test Renderer)

`iapService`, `notificationService`, `offlineService`, `parserConfigService`,
`profileService`, `ridesService`, `secureStorage`, `subscriptionService`,
`telemetryService`, `ocrParser` (fixtures), `dateUtils`, `deviceId`, `ratingPrompt`,
`withTimeout`, et un test de rendu de l'application.

### Observabilité en production

- **Sentry** (`@sentry/react-native`) — erreurs, breadcrumbs sur les flux sensibles (achats,
  scans).
- **`scan_events`** — qualité réelle de l'OCR sur le parc : *quel pourcentage de scans
  trouve les deux adresses, par plateforme ?* *quel est le taux de repli Gemini (donc le
  coût) ?* *comment se répartissent les verdicts ?*
- **`scan_failures`** — ce que la télémétrie classique ne voyait pas. Le raisonnement est
  écrit dans le code : *`telemetryService` et `scanDebugService` ne s'écrivent que sur un
  scan qui aboutit. Tout ce qui casse avant ne laissait aucune trace : un bug pouvait
  toucher tout le parc sans qu'aucune donnée ne le montre.*
- **`scan_debug`** — blocs OCR bruts pour rejouer un cas terrain en fixture. Purgé à 30 j,
  désactivable par l'utilisateur.
- **Écran Diagnostics** dans l'app, pour que le chauffeur puisse remonter un code d'erreur.

Toute la télémétrie est **fire-and-forget** : une erreur de traçage ne doit **jamais**
impacter un scan.

### Industrialisation

- **EAS Build** (Expo Application Services) — profils `development`, `preview`,
  `production`, auto-incrément de version, canaux séparés.
- Scripts `eas-build-pre-install` / `eas-build-post-install`, `bump-version.js`.
- **`patch-package`** — correctifs de dépendances versionnés dans `patches/`, réappliqués
  au `postinstall`.
- ESLint (config React Native) + Prettier 2.8.8 + TypeScript strict.
- 54 migrations SQL numérotées, avec un dossier `rollback/`.
- Un **audit technique et sécurité** formel a été mené (2 passes : 28 et 29 juin 2026),
  documenté dans `AUDIT_STRIVE_REPORT.md` : 2 critiques, 7 avertissements, 5
  recommandations d'architecture, 8 points forts — avec l'état de correction de chaque
  point. C'est une pièce forte sur la méthode de travail.

---

## 13. Sécurité et RGPD

| Sujet | Traitement |
|---|---|
| Session | Chiffrée dans le **Keychain** iOS / **Keystore** Android (`react-native-keychain`) |
| Secrets serveur | Clé Gemini, clé de service Firebase, service role : **jamais dans le bundle client** |
| Base de données | **RLS activée partout**, 40 policies, cloisonnement par `auth.uid()` |
| Écriture de télémétrie | Uniquement via RPC `SECURITY DEFINER` — aucun `INSERT` direct autorisé |
| Capture d'écran | Traitée **100 % en mémoire**, jamais persistée sur disque → conformité par conception |
| Télémétrie produit | **Non nominative** : tranches de prix, jamais le montant exact ; pas d'adresse, pas de coordonnées |
| Droit à l'effacement | RPC `delete_account` en cascade sur toutes les tables + révocation du jeton Apple |
| Effacement partiel | « Supprimer mon historique » disponible séparément de la suppression de compte |
| Rétention | `scan_debug` et `scan_failures` purgés à 30 jours par `pg_cron`, purge des adresses anciennes |
| Transparence | Chaque utilisateur peut lire ses propres `scan_events` (policy dédiée) |
| Opt-out | Le mode diagnostic est désactivable par l'utilisateur |
| Documents | `PRIVACY_POLICY.md` / `.en.md`, `TERMS_OF_SERVICE.md` / `.en.md` versionnés dans le dépôt |

**Point à défendre à l'oral :** la conformité n'a pas été ajoutée après coup. Elle est dans
la forme du système — traitement en mémoire, télémétrie en tranches, rétention automatisée
par cron, RLS par défaut. Et l'audit a montré la limite de l'exercice : la première version
de `delete_account()` laissait des adresses orphelines dans les tables de diagnostic. Le
correctif est daté et tracé (migration du 29/06). **Le raconter est plus fort que de le
taire** : ça montre un dispositif d'audit qui fonctionne.

---

## 14. Design et interface

Un document dédié existe : `docs/DESIGN-LANGUAGE.md`. Sa méthode est intéressante à citer
parce qu'elle est comparative et non déclarative : **deux rendus du même écran**, à
composants et mise en page identiques, l'un généré par un modèle, l'autre par une agence de
design. Le contenu est constant, seul le traitement change — c'est la comparaison la plus
propre disponible.

Conclusions retenues et appliquées :

- Un **champ lumineux continu** traversant tout l'écran, plutôt qu'un fond plat sur lequel
  des objets sont posés — les objets sont *plongés dans* le champ et changent d'apparence
  selon leur position.
- Le **matériau translucide** (verre givré, liseré lumineux diffus) devient la règle, le
  vert plein devient l'exception.
- **Le contraste maximal est réservé au chiffre qui compte.** Le mode d'échec identifié :
  quand tout est au maximum, plus rien ne mène l'œil.
- Le bord est un **dégradé d'intensité** sur le verre, un **trait** sur l'opaque, et on ne
  croise jamais les deux (`src/theme/stroke.ts`).

Autre principe de méthode, appris à la dure et consigné : **avancer par petits pas**. Une
refonte d'écran complète livrée d'un bloc a été rejetée en bloc ; les incréments montrables
passent.

Accessibilité : `useReduceMotion` respecte le réglage système de réduction des animations,
libellés et rôles d'accessibilité posés sur les contrôles.

---

## 15. Le site web

`web/` — **Next.js 16** (App Router) + React 19 + **Tailwind CSS 4**, déployé sur
**Vercel**, connecté à Supabase.

Page de **liste d'attente** avant lancement. La table `waitlist` n'est **jamais** lisible
ni écrivable directement par un visiteur anonyme : tout passe par la RPC `join_waitlist()`
(`SECURITY DEFINER`) qui valide le format, rejette les emails jetables, déduplique sur
l'email normalisé et **renvoie la position dans la file**. Lecture réservée aux
administrateurs. On capture aussi la source (`utm_source`), la langue du navigateur et le
référent tronqué — de quoi mesurer l'acquisition sans traqueur tiers.

---

## 16. Inventaire exhaustif des outils

### Langages et frameworks

| Outil | Version | Rôle |
|---|---|---|
| React Native | 0.84.0 | Framework mobile cross-platform |
| React | 19.2.3 | Bibliothèque UI |
| TypeScript | 5.8+ | Typage statique |
| Swift / Objective-C | — | Module natif iOS (OCR, App Intents, Live Activity, CarPlay) |
| Kotlin | — | Module natif Android (OCR, bulle, accessibilité) |
| Deno | — | Runtime des Edge Functions Supabase |
| PostgreSQL | — | Base de données (via Supabase) |
| SQL / PL/pgSQL | — | Migrations, triggers, RPC |
| Next.js | 16 | Site web / liste d'attente |
| Node.js | ≥ 20 (`package.json`) | Environnement de build |

### Backend et services

| Outil | Rôle |
|---|---|
| **Supabase** | Auth, PostgreSQL, RLS, Edge Functions, Storage, `pg_cron` |
| **Google Gemini 2.5 Flash** | Repli LLM d'extraction de données depuis l'image |
| **TomTom API** | Géocodage (`search/2/geocode`) et calcul d'itinéraire avec trafic (`routing/1/calculateRoute`) |
| **RevenueCat** | Abonnements et achats intégrés multiplateformes, webhooks |
| **Firebase Cloud Messaging** | Notifications push (HTTP v1, OAuth2 par compte de service) |
| **Sentry** | Monitoring d'erreurs en production |
| **Google Sign-In / Apple Authentication** | Connexion sociale |
| **Vercel** | Hébergement du site web |
| **EAS (Expo Application Services)** | Build et soumission iOS/Android |

### Bibliothèques natives clés (côté téléphone)

| Bibliothèque | Rôle |
|---|---|
| **Apple Vision** | OCR natif iOS |
| **Google ML Kit Text Recognition** | OCR natif Android |
| **ActivityKit** | Live Activity / Dynamic Island |
| **App Intents** | Intégration à l'app Raccourcis, Siri |
| **CarPlay** | Tableau de bord embarqué |
| **AccessibilityService / MediaProjection** | Capture d'écran Android |

### Bibliothèques React Native (dépendances de production)

| Paquet | Rôle |
|---|---|
| `@react-navigation/native-stack`, `/bottom-tabs` | Navigation |
| `@supabase/supabase-js` | Client Supabase |
| `react-native-purchases` | SDK RevenueCat |
| `@sentry/react-native` | Sentry |
| `@react-native-firebase/app`, `/messaging` | Firebase / FCM |
| `@react-native-google-signin/google-signin` | Google Sign-In |
| `@invertase/react-native-apple-authentication` | Sign in with Apple |
| `js-sha256` | Hachage du nonce Apple et de l'email |
| `react-native-keychain` | Stockage chiffré des secrets |
| `@react-native-async-storage/async-storage` | Cache hors-ligne |
| `@react-native-community/netinfo` | Détection de l'état réseau |
| `i18next`, `react-i18next` | Internationalisation FR/EN |
| `react-native-calendars` | Sélecteur de plage de dates (Analytics) |
| `react-native-video` | Vidéos de démonstration du tutoriel |
| `@react-native-community/blur` | Effet de verre givré |
| `react-native-linear-gradient` | Dégradés du champ lumineux |
| `@react-native-masked-view/masked-view` | Masques (dégradés de texte, effets) |
| `react-native-vector-icons` | Icônes |
| `react-native-safe-area-context`, `react-native-screens` | Zones sûres, écrans natifs |
| `react-native-bootsplash` | Écran de démarrage |
| `react-native-device-info` | Identifiant et informations appareil (anti-abus) |
| `react-native-push-notification` | Notifications locales |
| `@react-native-community/slider` | Réglage des seuils |
| `react-native-dotenv` | Variables d'environnement |
| `react-native-get-random-values`, `react-native-url-polyfill` | Polyfills |

### Outillage de développement

Jest · React Test Renderer · ESLint (`@react-native/eslint-config`) · Prettier 2.8.8 ·
Babel · Metro · `patch-package` · Gradle · CocoaPods / Bundler (Gemfile) · Git ·
Supabase CLI · Xcode · Android Studio · **Claude Code** (assistant de développement,
à citer en bibliographie conformément au règlement).

### Variables d'environnement

`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_KEY`, `REVENUECAT_API_KEY_IOS`,
`REVENUECAT_API_KEY_ANDROID`, `TOMTOM_API_KEY`, `SENTRY_DSN`, `GOOGLE_WEB_CLIENT_ID`,
`GOOGLE_IOS_CLIENT_ID`. Côté serveur uniquement : `GEMINI_API_KEY`,
`GEMINI_DAILY_BUDGET_CALLS`, `SUPABASE_SERVICE_ROLE_KEY`, `FCM_SERVICE_ACCOUNT_JSON`.

---

## 17. Chiffres clés (vérifiés dans le dépôt le 06/09/2026)

| Indicateur | Valeur |
|---|---|
| Commits | **221** (premier commit : 21 février 2026) |
| Durée de développement | ~6,5 mois |
| Code TypeScript / TSX | **~33 900 lignes** (81 fichiers `.ts` + 72 `.tsx`) |
| Code Swift | **~7 900 lignes** (17 fichiers) |
| Code Kotlin | **~3 800 lignes** (11 fichiers) |
| SQL | **~7 000 lignes** (62 fichiers) |
| **Total code applicatif** | **~52 600 lignes** |
| Écrans | 21 |
| Composants réutilisables | 25 |
| Services métier | 19 |
| Migrations SQL | 54 |
| Tables PostgreSQL | 15 |
| Fonctions / RPC PostgreSQL | 34 |
| Policies RLS | 40 |
| Edge Functions | 6 |
| Clés de traduction | **967 × 2 langues** (FR/EN, parité stricte) |
| Fichiers de fixtures OCR | 4 |
| Langues gérées par la détection d'adresse | 6 (FR, EN, ES, IT, NL, PT) |
| Plateformes VTC reconnues | 3 (Uber, Bolt, Heetch) |
| Pays couverts par TomTom | 13 |

---

## 18. Les chiffres réels (mesurés en base le 08/09/2026)

### 18.0 Périmètre — à énoncer avant tout chiffre

| Critère | Valeur |
|---|---|
| Fenêtre | **1ᵉʳ juillet → 6 septembre 2026** (2 mois) |
| Cohorte | comptes ayant **au moins 50 courses scannées** sur la fenêtre |
| Comptes retenus | **3** |
| Courses retenues | **2 943** |
| Courses écartées par le filtre | 62 (2,1 %) — comptes d'essai à 17, 20 et 25 courses |

Le seuil de 50 courses écarte les comptes ouverts puis abandonnés, dont le comportement
n'a rien à voir avec un usage professionnel et qui pèseraient dans les moyennes sans rien
représenter. **Il change les résultats à la marge** (2,1 % du volume), ce qui est en soi
un bon signe : les chiffres ne tiennent pas à quelques lignes. Le dire à l'oral en une
phrase — « nous ne retenons que les comptes à plus de 50 courses, et le filtre déplace les
résultats de moins de deux points » — vaut mieux que de se le faire demander.

L'un des trois comptes est celui du fondateur. À dire si la question vient : deux
chauffeurs tiers et le fondateur en usage réel.

Requêtes rejouables : `scripts/analytics-capstone.sql`.

---

### 18.1 LES SIX CHIFFRES À DIRE À L'ORAL

#### 1. « 2 943 offres de course réelles, analysées en deux mois »

Un jeu de données propriétaire sur un marché qui n'a **aucune API publique**. Personne ne
peut le reconstituer sans avoir construit l'outil. C'est l'argument d'entrée : le projet ne
produit pas une application, il produit **une donnée qui n'existait pas**.

#### 2. « Le tarif médian d'une offre est de 11,06 €, alors que la moyenne est de 18,04 € »

| | Moyenne | Médiane |
|---|---|---|
| Tarif | 18,04 € | **11,06 €** |
| Distance | 14,2 km | 6,2 km |
| Durée (approche incluse) | 26,4 min | 22 min |

L'écart moyenne/médiane est le cœur du problème : **la course typique est bien plus petite
que la course moyenne.** Une poignée de longues courses tire la perception vers le haut,
et le chauffeur arbitre chaque jour sur des offres à 11 €. C'est exactement ce qu'un
chauffeur ressent sans pouvoir le chiffrer — et c'est chiffré ici.

#### 3. « L'heure où le téléphone sonne le plus n'est pas l'heure où l'on gagne le mieux »

| Créneau | Volume d'offres | €/h moyen |
|---|---|---|
| 14 h – 17 h | **1 043** (le pic de volume) | 33 à 36 |
| 20 h – 21 h | 440 | **59,1 puis 50,5** |
| 18 h – 19 h | 326 | 41 à 44 |

La promesse du produit, démontrée par la donnée. Le pic d'activité de l'après-midi est
**le moins rentable de la journée**, et le créneau de 20 h paie **70 % de plus** pour un
volume encore confortable. Un chauffeur qui travaille « quand ça sonne » travaille au
mauvais moment. **C'est la meilleure slide du dossier.**

> Éviter de citer 1 h – 4 h du matin : les taux y sont hauts (44 à 50 €/h) mais sur
> 25 à 75 offres seulement. Trop peu pour être opposable, et c'est le premier endroit où
> un jury attentif ira chercher la faille.

#### 4. « La chaîne aboutit dans 82 % des cas — 89 % en excluant les refus volontaires »

⚠️ Ce chiffre-ci se mesure du **8 août au 6 septembre**, et non sur toute la fenêtre : la
table `scan_failures` n'existe que depuis le 8 août (migration `20260806`). Avant cette
date les échecs n'étaient pas comptés du tout, donc un taux de réussite calculé dessus
serait mécaniquement flatteur. C'est le seul indicateur du dossier qui a sa propre
fenêtre, et c'est assumé.

2 161 courses produites contre 470 échecs tracés, soit **82,1 %**. Sur ces 470,
**196 sont des comportements attendus** — scanner hors session (121), verrou anti
double-tap (75), quota atteint (6). En les retirant, le taux de réussite technique monte
à **88,7 %**.

Ce chiffre est fort parce qu'il est **mesuré et non déclaré** : il vient d'une table
construite exprès pour compter les échecs, pas seulement les succès. Peu de projets à ce
stade savent dire combien de fois ils échouent — et encore moins savent dire à partir de
quelle date leur propre mesure est valide.

#### 5. « 15 à 43 scans par jour d'activité, sur 28 à 40 jours »

| Chauffeur | Scans | Jours actifs | Scans / jour actif |
|---|---|---|---|
| A | 1 199 | 28 | **42,8** |
| B | 1 132 | 31 | **36,5** |
| C | 612 | 40 | **15,3** |

C'est le chiffre d'engagement, et c'est celui qu'il faut mettre en avant à la place du
nombre d'utilisateurs. Un outil ouvert 15 à 43 fois par journée de travail, sur plusieurs
semaines consécutives, n'est pas un gadget testé une fois : il est **entré dans le geste de
travail**. En rétention, c'est le signal le plus difficile à obtenir.

#### 6. « Le carburant pèse 4,8 % du tarif en essence, contre 2,9 % en électrique »

| Motorisation | n | Coût moyen / course | Part du tarif |
|---|---|---|---|
| Essence | 1 087 | 0,76 € | **4,8 %** |
| Électrique | 549 | 0,58 € | **2,9 %** |

Près de deux points de marge, mesurés course par course, avec le prix du carburant figé au
moment du scan. C'est un chiffre que personne d'autre ne peut produire, et il est
directement actionnable pour un chauffeur qui hésite à changer de véhicule.

---

### 18.2 Les chiffres de second rang (utiles en réponse à une question)

**Rentabilité proposée**, €/h approche comprise (les 14 profils ont `include_pickup` actif) :

| p10 | p25 | médiane | p75 | p90 |
|---|---|---|---|---|
| 23,4 | 28,1 | **34,8** | 46,6 | 67,5 |

Part des offres sous seuil : **3,8 %** sous 20 €/h · **15,2 %** sous 25 €/h ·
**12,3 %** sous 1 €/km · **32,9 %** sous 1,50 €/km.

> Si on cite le €/h, le dire ainsi : **« taux horaire pendant la course, trajet d'approche
> compris »**. Il n'inclut pas l'attente entre deux courses — donc ce n'est pas un revenu
> horaire. C'est un **indicateur d'arbitrage entre deux offres**, et c'est précisément son
> usage dans l'app. Cette précision, donnée spontanément en une demi-phrase, transforme une
> faiblesse en preuve de rigueur.

**Répartition par plateforme :** Uber 2 749 (**93,4 %**) · Bolt 193 (6,6 %) · Heetch 1.
Médiane du €/h : Uber 35,1 · Bolt 31,5. Le multi-plateformes est opérationnel
techniquement ; le marché testé est Uber. À présenter comme tel.

**Répartition des verdicts rendus :** 61,1 % vert · 30,2 % orange · 8,6 % rouge
(sur l'ensemble des `scan_events` de la fenêtre, cohorte non filtrée).

---

### 18.3 Ce qu'il ne faut PAS mettre sur une slide

Trois pièges identifiés en analysant la base. Les connaître protège pendant les 10 minutes
de questions.

**1. Ne rien conclure des courses « refusées ».** Jusqu'au **26 août 2026** (commit
`6887706`), toute course non acceptée le jour même **basculait automatiquement en
« refusée »**. Ces refus n'ont jamais été des décisions de chauffeur — c'est une donnée
inventée par un défaut d'implémentation, corrigé depuis (les courses non tranchées restent
« en attente », désormais pendant 7 jours). Conséquence directe : **tout taux d'acceptation
ou de « discipline » calculé sur l'historique antérieur au 26/08 est faux.** Depuis le
correctif, le volume décisionnel est encore trop mince pour conclure (8 acceptations et
16 refus côté testeurs sur 11 jours).

> Si la question vient quand même, la bonne réponse est celle-ci — et elle est à
> l'avantage : *« nous avons découvert en analysant la base qu'un statut par défaut
> fabriquait de la donnée. Nous l'avons corrigé le 26 août, et nous nous interdisons
> d'exploiter la période antérieure. »* C'est un réflexe d'intégrité de données, exactement
> ce qui est attendu d'un profil data.

**2. Ne pas présenter « 100 % des scans trouvent les deux adresses » comme un taux de
réussite du parser.** C'est vrai mais c'est un **biais de survie** : la télémétrie ne
s'écrit que quand une course est produite, donc quand les adresses existent déjà. Le vrai
chiffre de fiabilité est celui du §18.1 n° 4 (82 % / 89 % bout en bout), qui lui compte
les échecs.

**3. Ne pas citer de coût unitaire du LLM : il n'est pas mesuré.** `scan_events` affiche
0 % de repli Gemini sur toute la période, et c'est un trou d'instrumentation, pas une
performance : le drapeau n'est posé que par le repli JavaScript, alors que les scans réels
passent par le pipeline natif, qui appelle Gemini sans le remonter. Preuve directe :
77 échecs `gemini_ko` sur la même fenêtre. **C'est le correctif d'instrumentation
numéro un**, et il se dit très bien comme prochaine étape (§19).

**Bonus, observation produit :** sur 2 943 courses, **2 seulement** ont un tarif final
confirmé. La fonction de correction du tarif n'est pas utilisée. À ne pas mentionner
spontanément, mais c'est une décision produit réelle à prendre après l'oral.

---

### 18.4 Si tu as deux jours avant la soutenance

Le meilleur investissement de temps disponible, par ordre de rendement :

1. **Appeler deux bêta-testeurs.** Trente minutes d'entretien couvrent l'exigence d'enquête
   terrain, et donnent des verbatims qui valent plus qu'un graphique. Question à poser :
   *« qu'est-ce que l'app t'a montré que tu ne savais pas ? »*
2. **Refaire la slide du §18.1 n° 3** (volume vs rentabilité par heure) en graphique
   double axe. C'est la démonstration la plus visuelle du dossier.
3. **Poser le drapeau Gemini côté natif.** Une journée de travail, et le coût unitaire
   devient mesurable — donc citable.

---

## 19. Limites connues et prochaines étapes

**À assumer publiquement — les cacher est plus risqué que les nommer.**

1. **Bêta, pas encore publié sur les stores.** Il y a des chauffeurs qui utilisent l'app et
   2 943 courses réelles retenues sur 2 mois (§18), mais pas de distribution ouverte :
   donc **pas de conversion payante mesurée, pas de coût d'acquisition, pas de rétention**.
   Le bêta prouve que la chaîne technique tient en conditions réelles ; il ne prouve pas
   encore le marché. Et l'échantillon est un échantillon de convenance : peu de chauffeurs,
   une zone, une période.
2. **Le coût unitaire du LLM n'est pas mesuré.** Le drapeau de repli Gemini n'est posé
   que par le chemin JavaScript, alors que les scans réels passent par le pipeline natif :
   `scan_events` affiche donc 0 % de repli, ce qui est un trou d'instrumentation et non une
   performance (77 échecs `gemini_ko` sur la même période le prouvent). Correctif
   d'instrumentation prioritaire.
3. **La donnée de décision antérieure au 26 août 2026 est inexploitable.** Un statut par
   défaut faisait basculer en « refusée » toute course non acceptée le jour même. Corrigé
   (commit `6887706`) — les courses non tranchées restent « en attente », désormais
   pendant 7 jours — mais tout taux d'acceptation calculé avant cette date est faux, et le
   volume décisionnel accumulé depuis est encore trop mince pour conclure. Découvert **en
   analysant la base**, ce qui est le bon sens de la découverte.
4. **Les runners de fixtures Swift et Kotlin ne sont pas branchés en CI.** Le contrat
   existe, il est écrit, le runner TypeScript tourne — mais la parité des deux parsers
   natifs est aujourd'hui vérifiée à la main. Divergence déjà identifiée et documentée :
   le `priceWholeRegex` Swift accepte `\d{1,6}` là où le contrat exige `\d{2,6}`.
5. **Duplication de logique en trois langages** — arbitrage assumé (performance en
   arrière-plan), dette réelle. Le garde-fou est le contrat de fixtures, pas le compilateur.
6. **Trois plateformes VTC seulement.** Chaque nouvelle plateforme demande de nouvelles
   ancres et de nouvelles fixtures.
7. **Dépendance forte à l'interface d'un tiers.** Une refonte de l'app Uber peut casser le
   parsing du jour au lendemain. Mitigations en place : repli LLM, remote config,
   télémétrie qui rend la dégradation visible. Le risque n'est pas supprimé, il est
   instrumenté.
8. **Le prix de l'électricité n'a pas de source marché** — saisi par l'utilisateur, avec un
   repli.
9. **Sandbox RevenueCat encore autorisé en production** (`REVENUECAT_ALLOW_SANDBOX=true`,
   depuis le 27/07/2026). À retirer **après** publication sur l'App Store — le retirer
   avant fait rejeter l'app par la revue Apple.
10. **Export comptable** (CSV + import des relevés de plateformes) : arbitré, spécifié,
   reporté après le lancement.

---

## 20. Questions probables, et comment y répondre

Valables pour un jury, un investisseur ou un recruteur — ce sont les mêmes angles d'attaque.

**« Combien d'utilisateurs ? Quelle traction ? »**
Ne pas mener avec le nombre de comptes — c'est le chiffre le plus faible. Mener avec le
volume et l'intensité : **2 943 offres réelles analysées en deux mois**, par des chauffeurs
qui ouvrent l'outil **15 à 43 fois par journée de travail sur 28 à 40 jours**. Puis, si la
question du nombre revient : « une bêta fermée, une poignée de chauffeurs, dont deux
intensifs ». Et dire ce que ça ne prouve pas encore : la conversion payante. Un chiffre
modeste assumé et bien cadré passe ; un chiffre gonflé ne survit pas à la question
suivante.

**« Pourquoi maintenant ? »**
Trois choses convergent : l'OCR embarqué est devenu gratuit et instantané sur les
téléphones courants ; les LLM vision rendent abordable le rattrapage des cas que les règles
ne savent pas lire ; et la pression sur les revenus des chauffeurs rend l'arbitrage course
par course économiquement décisif. Aucune des trois n'était vraie il y a quelques années.

**« En quoi est-ce un sujet de data et pas juste du développement mobile ? »**
Toute la chaîne de valeur est une chaîne de données : la matière première est non
structurée (une image), elle est extraite par deux méthodes concurrentes qu'il a fallu
arbitrer sur coût/latence/précision, elle est enrichie par une source externe, normalisée,
datée, stockée sous un modèle versionné, puis exploitée analytiquement. Et le pilotage
lui-même est instrumenté : le taux de repli LLM est un indicateur de coût, la taxonomie
d'échecs est un dispositif de mesure de la qualité de la chaîne.

**« Pourquoi ne pas tout passer au LLM ? Ce serait plus simple. »**
Trois raisons, dans cet ordre. **Coût** : un appel par scan, avec un quota gratuit de 3
scans/jour et des comptes jetables, rend la facture non bornée — d'où le circuit breaker
global. **Latence** : 2 à 8 s contre ~200 ms, alors que le chauffeur a quelques secondes.
**Disponibilité** : le parsing local fonctionne hors-ligne, ce qui est le cas normal en
zone blanche. Le LLM apporte la robustesse sur les cas tordus ; on ne le paie donc que
quand le parsing local a échoué **et** l'a détecté — c'est le rôle des bornes de
plausibilité.

**« Comment savez-vous que votre extraction est correcte ? »**
Deux dispositifs. **Avant** : les fixtures, contrat exécutable partagé par les trois
implémentations, où tout correctif commence par un cas de test. **Après** : la télémétrie
non nominative, qui mesure sur le parc réel le taux de scans trouvant les deux adresses,
par plateforme — et `scan_failures`, qui trace les scans qui n'aboutissent même pas. Sans
cette seconde table, un bug pouvait toucher tout le parc sans laisser une seule trace.

**« Que se passe-t-il si Uber refait son interface ? »**
Le risque est structurel et il est instrumenté plutôt que nié. Le repli LLM absorbe les cas
que les règles ne savent plus lire ; la remote config permet de patcher les ancres depuis
Supabase **sans republier** (jours → minutes) ; la télémétrie fait apparaître la
dégradation avant que le support ne la remonte.

**« Et le RGPD, avec des captures d'écran et des adresses ? »**
La capture n'est jamais écrite sur disque : traitement 100 % en mémoire. La télémétrie
produit est non nominative par construction (tranches de prix, jamais le montant exact,
jamais d'adresse). Les seules données pouvant contenir une adresse hors des courses du
chauffeur sont les captures de diagnostic — purgées à 30 jours par tâche planifiée, et
désactivables. Le droit à l'effacement est implémenté en cascade, et l'audit interne a
justement trouvé que la première version laissait des orphelines : c'est corrigé, daté et
tracé.

**« Quel est votre modèle économique, et tient-il ? »**
Freemium à trois paliers, avec des packs de scans en consommable. La variable de coût
critique n'est pas l'hébergement, c'est **l'appel LLM** — d'où un modèle où le gratuit est
plafonné à 3 scans/jour, où l'anti-abus est traité à quatre niveaux, et où un circuit
breaker global protège la facture indépendamment du nombre de comptes.

**« Qu'est-ce qui vous distingue d'un concurrent ? »**
La réponse honnête tient au verrou : le concurrent doit résoudre le même problème
d'extraction sans API, et c'est là que se trouve la difficulté réelle — pas dans le calcul
d'un €/h, qui est une division. Ce qui se défend, c'est la chaîne : cascade de coût,
enrichissement trafic, coût carburant figé et daté, verdict personnalisé sur des seuils
choisis par le chauffeur, et l'affichage **par-dessus** l'app VTC sans jamais la quitter.

**« Quelles sont les limites de votre travail ? »**
Voir §19 — et les donner spontanément. Pas d'usage réel encore mesuré, parité des parsers
natifs non vérifiée automatiquement, duplication en trois langages, dépendance à
l'interface d'un tiers.

**« Si vous recommenciez, que feriez-vous autrement ? »**
Deux réponses solides. **Un** : brancher les runners de fixtures natifs dès le premier
parser natif, pas après — le contrat sans exécution n'est qu'une intention. **Deux** :
chercher l'idempotence en amont avant de créer une table pour l'obtenir en aval (le
`scan_ledger` a été construit puis démonté quand la clé a été frappée plus tôt dans la
chaîne).

---

## 21. Le cadre de l'oral (contexte, pas un corset)

La présentation a lieu dans le cadre du **Professional Capstone** de PST&B (M2 Data Science
in Business, 2025-2026, tuteur M. ZARG AYOUNA Mahdi). Le titre visé est le **RNCP 37750**,
« Concepteur manager des infrastructures de données massives ».

**Ce qui est réellement contraignant** — le reste est de la forme, à respecter sans s'y
soumettre :

| Contrainte | Détail |
|---|---|
| Durée | **15 min de présentation**, **10 min de questions**, 5 min de délibération |
| Anglais | Une partie de l'oral est **en anglais** (celle qui correspond à l'introduction et à la revue de littérature) |
| Support | Libre, mais il faut pouvoir soutenir **sans** lire ; prévoir une version papier pour le jury et venir avec son matériel |
| Écrit | ~50 pages + 15 d'annexes ; introduction et revue de littérature en anglais ; sommaire automatisé ; bibliographie alphabétique |
| IA | Usage autorisé, mais **les prompts se citent** en bibliographie et les passages repris tels quels vont entre guillemets. Turnitin passe sur le rendu |
| Retard | −2 points le 1ᵉʳ jour, −4 le 2ᵉ, etc. |

**Ce que le jury note à l'oral :** compréhension du sujet, intérêt de la question traitée,
justification des choix (pourquoi cette méthode, pourquoi ces résultats), maîtrise de
l'oral et des questions, qualité du support, tenue professionnelle.

**Le point de vigilance, dit franchement.** L'école attend une démarche
*empirico-inductive* : un phénomène observé sur le terrain, éclairé par de la littérature,
instruit par une enquête, débouchant sur des préconisations. Un projet de startup entre
très bien dans ce moule sans se déguiser en mémoire théorique — à une condition : **ne pas
présenter « j'ai construit une app », mais « j'ai constaté un problème, je l'ai mesuré,
voilà ce que les données disent, voilà ce que j'en conclus »**. Le §18 est ce qui fait
tenir ça debout, parce qu'il y a de la donnée réelle derrière. La technique (§5 à §12)
devient alors la preuve, pas le sujet.

Formulations possibles de la question traitée, si on en veut une explicite :

- Dans quelle mesure une chaîne de traitement embarquée (OCR local + repli LLM) permet-elle
  de rendre exploitable, en quelques secondes et à coût maîtrisé, une donnée que les
  plateformes VTC n'exposent que sous forme d'image ?
- Comment construire une infrastructure de données pour un acteur indépendant dont la
  matière première appartient à des plateformes tierces qui n'offrent aucune API ?
- À quelles conditions un travailleur de plateforme peut-il reconstituer, à partir de ses
  propres traces, l'information économique que l'intermédiaire ne lui donne pas ?

### Correspondance rapide avec les blocs RNCP 37750

Utile si le jury y renvoie ; inutile d'en faire une section de la présentation.

| Bloc | Ce qui y répond dans Strive |
|---|---|
| **B1** Architecture d'acquisition, traitement, stockage | Chaîne à trois étages : OCR embarqué → cascade de traitement → PostgreSQL modélisé, 15 tables, 54 migrations |
| **B2** Extraction de données brutes structurées et non structurées | Source non structurée par excellence — une image d'écran, sans API — plus des sources externes (TomTom, prix carburant, webhooks) |
| **B3** Données exploitables par l'IA et l'analyse humaine | `scan_events` / `scan_failures` / `scan_debug` : socle analytique séparé du métier, pseudonymisé par construction (§12, §18) |
| **B4** Pilotage ETL et API | Extraction → transformation (normalisation, enrichissement, coût figé) → chargement idempotent ; 6 API serveur ; remote config ; 54 migrations avec rollback |
| **B5** Industrialisation, données fiables | Contrat de test partagé entre 3 parsers, idempotence, fail-closed, coupe-circuit budgétaire, rétention par `pg_cron`, RLS par défaut |

### Lexique pour la partie en anglais

À ne pas improviser le jour J :

| Français | Anglais |
|---|---|
| Chauffeur VTC / travailleur de plateforme | ride-hailing driver / platform worker, gig worker |
| Économie des plateformes | platform economy, gig economy |
| Course / offre de course | ride, trip / ride request, fare offer |
| Rentabilité | profitability |
| Taux horaire / taux au km | hourly rate / per-kilometre rate |
| Coût carburant, marge nette | fuel cost, net margin |
| Trajet d'approche | pickup leg, deadhead |
| Capture d'écran | screenshot |
| Reconnaissance optique de caractères | optical character recognition (OCR) |
| Extraction de données | data extraction |
| Chaîne de traitement | pipeline |
| Repli, solution de repli | fallback |
| Dégradation gracieuse | graceful degradation |
| Traitement embarqué / sur l'appareil | on-device processing, edge computing |
| Asymétrie d'information | information asymmetry |
| Management algorithmique | algorithmic management |
| Opacité algorithmique | algorithmic opacity |
| Portabilité des données | data portability |
| Fiabilité, robustesse | reliability, robustness |
| Limitation de débit | rate limiting |
| Coupe-circuit | circuit breaker |
| Idempotence | idempotency |
| Sécurité au niveau de la ligne | row-level security |
| Conservation des données | data retention |
| Confidentialité dès la conception | privacy by design |
| Échantillon de convenance | convenience sample |

**Champs de littérature mobilisables** (pour la partie anglaise de l'écrit) : algorithmic
management et gig economy — asymétrie d'information entre plateformes et chauffeurs,
autonomie des travailleurs de plateforme ; information asymmetry et théorie de l'agence ;
on-device machine learning et compromis edge/cloud ; extraction d'information hybride
OCR + LLM ; portabilité des données et RGPD appliqués au travail de plateforme.

> ⚠️ Ce sont des **directions**, pas des références vérifiées. Chaque source doit être
> retrouvée, lue et citée au format imposé avant d'entrer dans la bibliographie. Ne jamais
> citer une référence qu'on n'a pas ouverte — le contrôle anti-plagiat et une question du
> jury la trouveront.

---

## 22. Carte du dépôt et glossaire

### Où trouver quoi

```
strive/
├── src/
│   ├── screens/          21 écrans
│   ├── components/       25 composants (dont ErrorBoundary, ScanPreview, charts)
│   ├── services/         19 services métier
│   │   └── scanner/      ocrParser.ts (647 l.), geminiFallback.ts, ponts iOS/Android
│   ├── hooks/            useOfflineSync, useNetworkStatus, useReduceMotion
│   ├── utils/            qualityScore, bestHours, incomeGoal, chartBuckets, dateUtils…
│   ├── types/            database.ts — le modèle de données commenté
│   ├── locales/          fr.json, en.json (967 clés chacun)
│   └── theme/            palette, elevation, stroke
├── ios/Strive/
│   ├── AppIntents/       AnalyzeRideIntent.swift — le point d'entrée du scan iOS
│   ├── Scanner/          OcrParser.swift, ScanProcessor.swift, TomTomService.swift
│   ├── ScanBridge/       pont RN, Vision OCR, Gemini
│   ├── LiveActivity/     Dynamic Island
│   └── CarPlay/
├── android/app/src/main/java/com/strive/app/scanner/
│                         FloatingBubbleService.kt, OcrParser.kt, Accessibility…
├── supabase/
│   ├── migrations/       54 migrations SQL commentées (excellente lecture)
│   ├── functions/        6 edge functions Deno
│   └── rollback/
├── fixtures/ocr/         contrat de test partagé des 3 parsers
├── web/                  Next.js 16 — liste d'attente
├── docs/                 DESIGN-LANGUAGE.md, RELEASE_IOS.md, REVENUECAT_SETUP.md
├── AUDIT_STRIVE_REPORT.md   audit sécurité 2 passes
├── CONTEXTE_APP.md          version antérieure de ce document (partiellement périmée)
├── PRIVACY_POLICY.md / TERMS_OF_SERVICE.md (+ .en)
└── BRIEFING-ORAL-CAPSTONE.md   ← ce fichier
```

> ⚠️ `CONTEXTE_APP.md` date d'une version antérieure de l'architecture. Il décrit un parser
> unique en TypeScript appelé depuis le natif, et Gemini 1.5 Flash. **Les deux sont
> périmés** : le parsing vit désormais aussi en Swift et en Kotlin, et le modèle est
> Gemini 2.5 Flash. En cas de contradiction, **ce fichier-ci fait foi**.

### Glossaire

| Terme | Définition |
|---|---|
| **VTC** | Voiture de transport avec chauffeur |
| **OCR** | Optical Character Recognition — extraction de texte depuis une image |
| **ML Kit** | Bibliothèque de vision par ordinateur de Google, embarquée sur Android |
| **Vision** | Framework de vision par ordinateur d'Apple, embarqué sur iOS |
| **LLM** | Large Language Model — ici Gemini 2.5 Flash, utilisé en vision |
| **Fallback / repli** | Solution de secours activée quand la voie principale échoue |
| **Sanity bounds** | Bornes de plausibilité qui invalident un résultat aberrant |
| **Fixture** | Cas de test figé : entrée connue, sortie attendue |
| **Bridge** | Pont d'appel entre le code natif et le JavaScript de React Native |
| **RLS** | Row-Level Security — cloisonnement des lignes par utilisateur en base |
| **RPC** | Procédure stockée appelable depuis le client |
| **`SECURITY DEFINER`** | Fonction SQL s'exécutant avec les droits de son créateur |
| **Edge Function** | Fonction serverless exécutée près de l'utilisateur (Deno, chez Supabase) |
| **Idempotence** | Propriété d'une opération qui, rejouée, ne produit pas d'effet supplémentaire |
| **Circuit breaker** | Coupe-circuit qui bloque une dépense ou un appel au-delà d'un seuil |
| **Fail-closed** | En cas de panne, on refuse plutôt que d'autoriser |
| **Entitlement** | Droit d'accès accordé par un abonnement (vocabulaire RevenueCat) |
| **Live Activity** | Carte iOS vivante à l'écran verrouillé et dans la Dynamic Island |
| **App Intent** | Action d'une app exposée à Siri et à l'app Raccourcis |
| **AssistiveTouch** | Bouton flottant système d'iOS, déclencheur du scan |
| **MediaProjection** | API Android de capture d'écran |
| **`pg_cron`** | Planificateur de tâches à l'intérieur de PostgreSQL |
| **EAS** | Expo Application Services — service de build et de soumission |
| **Tag / taguer une course** | Marquer une course comme prise ou refusée — ce qui la rend exploitable statistiquement |
