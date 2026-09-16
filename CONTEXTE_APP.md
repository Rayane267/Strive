# Contexte de l'application Strive

> Document de synthèse destiné à donner à un assistant IA (ou à un lecteur) une
> compréhension complète de l'application **Strive** sans avoir à lire le code
> source. Rédigé à partir du dépôt réel, à jour au **7 septembre 2026**
> (branche `strive-vert`, 221 commits).
>
> Pour la préparation de l'oral (pitch, chiffres mesurés en base, questions du
> jury), voir le document séparé `BRIEFING-ORAL-CAPSTONE.md`. Le présent
> document décrit **le produit et le système**, rien d'autre.

---

## 1. Présentation générale

**Strive** est une application mobile (iOS & Android) destinée aux **chauffeurs
VTC** (Uber, Bolt, Heetch). Elle répond à un problème concret du métier : sur
ces plateformes, le chauffeur doit décider en quelques secondes s'il accepte ou
refuse une course, à partir d'une offre affichée à l'écran. Cet écran lui donne
un prix — jamais le taux horaire réel, jamais le coût du carburant, jamais
l'effet du trajet d'approche ni du trafic. Autrement dit, jamais la rentabilité.

Le verrou est structurel : **les plateformes n'exposent aucune API au
chauffeur**. La donnée existe, elle est affichée, mais elle est *enfermée dans
une image*, quelques secondes. Toute la chaîne de valeur de Strive consiste à
transformer ce pixel en donnée structurée, fiable et datée.

L'application permet de :

1. **Scanner** l'écran d'offre en un geste, sans quitter l'app VTC, et en
   extraire prix, distance, durée et adresses.
2. **Calculer la rentabilité réelle** (€/h, €/km, coût carburant, profit net) et
   rendre un **verdict vert / orange / rouge** selon des seuils personnels.
3. **Historiser et analyser** : historique, revenus, meilleurs créneaux
   horaires, score de qualité et de discipline.
4. **Gérer son activité** : profil, véhicule, préférences, abonnement.

Modèle économique : **freemium à trois paliers** (free / plus / premium) avec
crédits de scan, géré via RevenueCat.

**État du produit :** en bêta fermée, pas encore publié sur les stores. Une
liste d'attente est ouverte sur le site web.

---

## 2. Proposition de valeur

| Problème du chauffeur VTC | Réponse de Strive |
|---|---|
| Décider en quelques secondes si une course est rentable | Scan instantané, verdict affiché par-dessus l'app VTC |
| Le prix affiché ne dit rien de la rentabilité | €/h et €/km calculés, trajet d'approche inclus |
| Coût réel masqué | Déduction du carburant (prix du jour × consommation du véhicule), figée dans la course |
| Distance et durée annoncées peu fiables | Vérification par géocodage et calcul d'itinéraire TomTom, trafic compris |
| Pas de suivi consolidé multi-plateformes | Historique et analytics unifiés Uber / Bolt / Heetch |
| « Quand travailler ? » | Grille 7 × 24 sur son propre historique : où ça sonne ≠ où ça paie |
| Réseau instable en voiture | Mode hors-ligne, journal natif des scans, synchro différée |

### Le verdict en trois couleurs

Le chauffeur fixe un **€/h minimum** et un **€/km minimum**. Les deux seuils
dépassés → **vert** ; un seul → **orange** ; aucun → **rouge**. Le verdict est
calculé au scan, puis **rejoué a posteriori** dans les statistiques pour mesurer
la qualité des courses prises *et* la discipline de tri.

---

## 3. Stack technique

- **Framework** : React Native 0.84 / React 19 / TypeScript 5.8
- **Langages natifs** : Swift + Objective-C (iOS), Kotlin (Android)
- **Navigation** : React Navigation (native-stack + bottom-tabs)
- **Backend** : Supabase — Auth, PostgreSQL, RLS, Edge Functions (Deno), `pg_cron`
- **Authentification** : Supabase Auth + Google Sign-In + Apple Authentication
- **Paiements** : RevenueCat (`react-native-purchases`) + webhook serveur
- **OCR** : ML Kit Text Recognition (Android), framework Vision (iOS), en natif
- **Repli IA** : **Google Gemini 2.5 Flash**, via une edge function Supabase
- **Cartes / itinéraires** : API TomTom (geocode + routing), 13 pays
- **Notifications** : Firebase Cloud Messaging (HTTP v1) + notifications locales
- **Monitoring** : Sentry
- **i18n** : i18next (fr / en), 967 clés en parité stricte
- **Stockage local** : AsyncStorage (cache offline) + Keychain / Keystore (secrets)
- **Tests** : Jest + React Test Renderer — 16 suites, 184 tests
- **Build** : EAS (Expo Application Services), `patch-package` au postinstall
- **Site web** : Next.js 16 + Tailwind CSS 4, déployé sur Vercel

---

## 4. Architecture logicielle

```
src/
├── components/   25 composants UI (+ ErrorBoundary par écran)
├── context/      AuthContext — état d'authentification global
├── hooks/        useOfflineSync, useNetworkStatus, useReduceMotion
├── navigation/   RootNavigator (stack) + TabNavigator (onglets)
├── screens/      21 écrans
├── services/     16 services métier + module scanner
├── types/        database.ts — le modèle de données, commenté
├── locales/      fr.json / en.json
└── theme/        palette, elevation, stroke, spacing, radius, motion
ios/Strive/       AppIntents, Scanner, ScanBridge, LiveActivity, CarPlay
android/…/scanner FloatingBubbleService, OcrParser, Accessibility, bridge
supabase/         56 migrations SQL + 6 edge functions + rollback/
fixtures/ocr/     contrat de test partagé des 3 parsers
web/              Next.js — liste d'attente
```

### Principes d'architecture

1. **Le calcul lourd vit en natif.** L'OCR et le parsing tournent dans le
   processus natif, sans réveiller le moteur JavaScript : le chauffeur dispose
   de quelques secondes, pas du temps de démarrage d'un bundle RN.
2. **Le serveur tranche, le client optimise.** Le compteur de quota local est un
   cache *permissif* : laisser passer un scan de trop coûte un scan, bloquer un
   scan légitime immobilise un chauffeur qui paie. Le trigger
   `enforce_scan_quota` arbitre.
3. **Aucun secret exploitable dans le bundle client.** La clé Gemini n'existe
   que côté serveur, derrière une edge function authentifiée.
4. **Isolation des pannes.** Chaque écran a son `ErrorBoundary`.
5. **Remote config.** Ancres de prix et bornes de plausibilité du parser sont
   patchables depuis Supabase **sans republier sur les stores**.
6. **Fail-closed sur ce qui coûte.** Si la base est injoignable, le proxy Gemini
   refuse plutôt que de laisser le compteur de coût sans garde-fou.
7. **Privacy by design.** La capture d'écran est traitée **100 % en mémoire**,
   jamais persistée sur disque.

---

## 5. Le scanner — pipeline en cascade

```
Capture d'écran (en mémoire, jamais écrite sur disque)
   ↓
[1] OCR NATIF                      gratuit · hors-ligne · ~200 ms
    Vision (iOS) / ML Kit (Android) → blocs {text, x, y, w, h}
   ↓
[2] PARSING SÉMANTIQUE             gratuit · déterministe
    plateforme → tarif → distance/durée → adresses → bornes de plausibilité
   ↓ succès ──────────────► verdict affiché IMMÉDIATEMENT
   ↓ échec ou valeur aberrante
[3] REPLI LLM                      payant · ~2-8 s · en ligne
    image compressée → edge function `gemini-proxy` → Gemini 2.5 Flash
    → JSON structuré, revalidé
   ↓
[4] ENRICHISSEMENT TOMTOM          arrière-plan · ~1-4 s
    géocodage des 2 adresses → itinéraire avec trafic
    → distance et durée réelles ; si TomTom échoue → valeurs OCR conservées
   ↓
[5] COÛT CARBURANT + VERDICT FINAL
    prix du jour × consommation × distance → fuel_cost et net_profit FIGÉS
   ↓
[6] ÉCRITURE : course en base + télémétrie non nominative + décision du chauffeur
```

### Trois implémentations du même parser

Le parsing existe **trois fois** : `src/services/scanner/ocrParser.ts` (647 l.),
`ios/Strive/Scanner/OcrParser.swift` (950 l.),
`android/…/scanner/OcrParser.kt` (1041 l.).

C'est un **arbitrage assumé** : le scan doit tourner en arrière-plan sans
démarrer le bundle JS. Le prix payé est la duplication ; le garde-fou est
`fixtures/ocr/`, jeu de cas JSON qui sert de **contrat commun** aux trois. Règle
inscrite dans le dépôt : *tout correctif de parser commence par une fixture*.

### Difficultés réellement traitées

| Problème | Traitement |
|---|---|
| Espaces parasites de l'OCR (`17 , 18 €`) | Regex tolérant les espaces autour du séparateur décimal |
| Uber en mode sombre n'affiche pas « Uber » | Détection par tournures (« exclusivité », « montant net ») et catégories exclusives (`uberx`, `berline`) |
| Ligne statistique confondue avec une adresse | Mots-clés de voie et POI en **6 langues** (FR, EN, ES, IT, NL, PT) |
| Offre véhicule électrique affichant recharge et autonomie | Filtre de contexte EV. Le mot « charge » seul est **proscrit** : « prise en charge » désigne le pickup |
| Format FR « 11 min (à 2,6 km) » | Le séparateur de la regex d'approche accepte des lettres — sans quoi l'approche n'entrait jamais dans le total, et le €/h était faux sans aucun signal |
| Montant à un chiffre (« 5 € ») | Décision actée en fixture : ce n'est pas un tarif |
| Texte coupé entre blocs | Recollage (« stitching »), fixtures dédiées |

### Bornes de plausibilité (patchables à distance)

Tarif **8 – 200 €** · distance **0,3 – 500 km** · taux **0,4 – 12 €/km**.
Une valeur hors bornes ne produit pas un résultat faux : **elle déclenche le
repli LLM**. C'est ce qui empêche une hallucination d'OCR d'atterrir
silencieusement dans les statistiques.

---

## 6. Les surfaces natives

Le chauffeur **ne doit pas quitter son application VTC** pendant qu'il regarde
l'offre. Strive ne s'ouvre donc pas.

### iOS

- **Déclenchement** : un **raccourci** (app Raccourcis) enchaînant « capture
  d'écran » → « Analyser une course avec Strive », un **App Intent** exposé par
  l'app. Déclenché par **AssistiveTouch** (voie recommandée), par **Toucher
  l'arrière**, par le widget ou Siri.
- L'intent est un `LiveActivityIntent` et tourne **en arrière-plan**
  (`openAppWhenRun = false`, volontaire).
- **Affichage** : Live Activity / **Dynamic Island** par-dessus l'app VTC, plus
  une notification actionnable (boutons Prise / Refusée).
- **CarPlay** : tableau de bord en lecture seule, quatre lignes, €/h en tête.

Points de concurrence traités, spécifiques à ce mode d'exécution : reprise
unique de continuation (deux `resume` font crasher le processus), verrou
anti-double-scan **inter-processus** via l'App Group (chaque scan tourne dans
son propre processus, un booléen ne suffit pas), et sérialisation du
`LiveActivityManager`, touché depuis quatre contextes d'exécution concurrents.

### Android

- **Déclenchement** : une **bulle flottante** en surimpression. Deux permissions
  requises : service d'accessibilité et affichage par-dessus les autres apps.
- **Capture** : `AccessibilityService.takeScreenshot()` sur Android 11+,
  `MediaProjection` en dessous.
- **Affichage** : le verdict, le tarif, la distance, la durée, le €/h et le €/km
  s'affichent dans la bulle elle-même. Notification avec boutons de décision.

### Le tag, étape stratégique

Le chauffeur tape « Prise » ou « Refusée » sans ouvrir l'app. **C'est ce geste
qui transforme un scan en donnée exploitable.** Une course non taguée reste
`PENDING`. Une relance push (« Tague tes courses ») est déclenchée par `pg_cron`
dès qu'un chauffeur cumule 5 courses non taguées.

---

## 7. Modèle de données

15 tables PostgreSQL, **56 migrations** versionnées, **40 policies RLS**,
34 fonctions / RPC.

### Tables métier

| Table | Contenu |
|---|---|
| `profiles` | Identité, statut en ligne, abonnement (palier, statut, expiration, produit), crédits, quota journalier (`daily_scans_count`, `daily_scans_day`), fuseau horaire, véhicule (marque, modèle, carburant, consommation, prix kWh) |
| `rides` | Plateforme, statut, tarif estimé vs final, distance, durée, €/h, €/km, `fuel_cost`, `net_profit`, adresses, `scan_ts`, `decided_at` |
| `preferences` | Seuils €/h et €/km, `day_reset_hour`, `include_pickup`, `deduct_fuel`, langue, opt-out diagnostic |
| `fuel_prices` | Prix carburant par type et région |
| `subscription_products` | Catalogue produits — source de vérité côté base |
| `plan_limits` | Limites par palier (scans/jour, profondeur analytique) |

### Tables d'observation et de gouvernance

| Table | Rôle |
|---|---|
| `scan_events` | Télémétrie produit **non nominative** : plateforme, nombre d'adresses trouvées, repli Gemini, source de la durée, verdict, **tranche** de tarif — jamais le montant exact, jamais d'adresse |
| `scan_failures` | Scans qui **n'aboutissent pas** : 12 motifs fermés, 3 surfaces (`shortcut`, `share_ext`, `bubble`) |
| `scan_debug` | Blocs OCR bruts pour rejouer un cas en fixture — purge à 30 jours, opt-out utilisateur |
| `audit_log` | Journal serveur ; sert aussi de compteur au rate limiting Gemini |
| `device_signups`, `welcome_grants` | Anti-abus, traçabilité des cadeaux |
| `processed_webhook_events` | Idempotence des webhooks RevenueCat |
| `support_tickets`, `support_messages` | Support intégré, priorité automatique |
| `waitlist` | Liste d'attente pré-lancement (site web) |

### Fonctions notables

`enforce_scan_quota` (autorité sur le quota : quota journalier → crédits de
bienvenue → crédits achetés) · `user_day_start` / `user_stats_today` (la journée
de travail démarre à l'heure choisie, dans le fuseau du chauffeur — un chauffeur
de nuit ne doit pas voir sa journée coupée à minuit) · `apply_revenuecat_event`
(idempotent) · `prevent_tier_tampering` · `delete_account` (cascade RGPD) ·
`effective_tier` · `log_scan_event` / `log_scan_failure` / `log_scan_debug`
(`SECURITY DEFINER` — aucun client n'insère de ligne arbitraire) ·
`skip_duplicate_ride` · les purges de rétention · `close_pending_rides`.

---

## 8. Backend Supabase

### Six edge functions (Deno)

| Function | Rôle |
|---|---|
| **`gemini-proxy`** | Proxy authentifié vers Gemini Vision — la pièce la plus durcie |
| `revenuecat-webhook` | Synchronisation serveur des abonnements, idempotente |
| `apple-revoke` | Révocation du jeton Apple à la suppression de compte |
| `fuel-prices` | Alimentation de la table des prix carburant |
| `notify-untagged` | Relance « Tague tes courses », via FCM HTTP v1 (OAuth2 par compte de service) |
| `notify-ticket-reply` | Notification de réponse à un ticket de support |

### `gemini-proxy` en détail

Cinq couches : **JWT revérifié côté fonction** (défense en profondeur, la clé
anonyme seule est refusée) · **rate limit 60 appels/h par utilisateur** ·
**circuit breaker global de 2 000 appels / 24 h glissantes**, tous utilisateurs
confondus et ajustable par secret sans redéploiement (*le rate limit par
utilisateur ne suffit pas : 100 comptes gratuits, c'est 6 000 appels/h*) ·
**plafond de charge utile à 2 Mo** · **validation structurelle + CORS restreint**.
Le tout **fail-closed**, et sans fuite d'infrastructure vers le client.

### Tâches planifiées (`pg_cron`)

Purge de `scan_debug` (30 j) · purge de `scan_failures` · purge des adresses
anciennes · relance des courses non taguées · **clôture hebdomadaire des courses
non tranchées** (voir §14).

---

## 9. Fonctionnement hors-ligne

Le réseau est instable en voiture. Trois dispositifs :

1. **Cache AsyncStorage** (courses, statistiques, préférences) pour la
   consultation sans connexion. Le cache est **versionné** : un changement de
   version vide les données obsolètes.
2. **Journal natif des scans** : chaque scan est journalisé *avant* d'être émis
   vers le JS, et n'est effacé que sur accusé de réception une fois la course en
   base. Un scan ne peut donc pas se perdre si le JS reçoit l'événement puis
   échoue à l'écrire.
3. **Idempotence du rejeu** : l'identité de la course (`rideId`) est frappée
   **au moment du scan** par le natif et portée jusqu'à `rides.id`. Rejouer un
   scan réinsère la même course, écartée sur la clé primaire.

---

## 10. Monétisation et quotas

| Palier | Scans / jour | Profondeur analytique | Seuils personnalisables |
|---|---|---|---|
| **Free** | 3 | 1 jour | Non (seuils imposés) |
| **Plus** | 30 | 7 jours | Oui |
| **Premium** | illimité | illimitée | Oui |

**Produits** : `strive_plus_monthly` / `_yearly`, `strive_premium_monthly` /
`_yearly`, et des packs de scans consommables (`_xs` 1, `_s` 3, `_m` 5, `_l` 10).
Entitlements RevenueCat : `plus`, `premium`.

**Trois natures de crédit, volontairement séparées** : le quota journalier du
palier (se réinitialise), les **crédits de bienvenue** (30 scans offerts une
fois par appareil, qui **périment**), et les **crédits achetés** (qui ne périment
**jamais**). D'où l'ordre de consommation : on brûle toujours en premier ce qui
a une date de péremption.

**Anti-abus** — 3 scans gratuits × N comptes jetables = service gratuit illimité
et facture Gemini pour l'éditeur. Quatre couches : blocklist de domaines
jetables · email normalisé et unique (neutralise les alias Gmail) · quota
d'inscriptions par identité et par appareil · cooldown de 60 s entre
l'inscription et le premier scan. Plus le circuit breaker global côté serveur.

**Statuts d'abonnement** gérés : `active`, `in_grace_period`, `expired`,
`cancelled`, `paused`, `refunded` — avec période de grâce, remboursement et
révocation en cas de transfert.

---

## 11. Les 21 écrans

| Écran | Rôle |
|---|---|
| `AuthScreen` | Connexion / inscription — email, Google, Apple |
| `OnboardingScreen`, `TutorialScreen` | Première utilisation, installation du raccourci ou des permissions |
| `ProfileSetupScreen`, `WelcomeGiftScreen` | Profil chauffeur, 30 scans offerts |
| `DashboardScreen` | Écran principal : session, gain du jour, scan |
| `AnalyticsScreen` | Revenus, KPI, graphiques, créneaux, score qualité |
| `BestHoursScreen` | Grille 7 × 24 : où ça sonne, où ça paie |
| `HistoryScreen` | Historique, tag a posteriori |
| `ProfileScreen`, `AccountInfoScreen` | Compte, suppression, effacement d'historique |
| `CarSettingsScreen` | Véhicule, carburant, consommation, prix kWh |
| `PreferencesScreen` | Seuils, heure de reset, langue, notifications |
| `SubscriptionScreen`, `ShopScreen` | Abonnements et packs |
| `SupportTicketsScreen`, `SupportTicketDetailScreen` | Support intégré |
| `HelpScreen`, `ScannerPermissionScreen`, `ResetPasswordScreen` | Aide, permissions, mot de passe |
| `DiagnosticsScreen` | Diagnostic technique (support terrain) |

---

## 12. Qualité, tests, observabilité

- **Fixtures OCR partagées** (`fixtures/ocr/`, 4 fichiers) : contrat exécutable
  des trois parsers. Le runner TypeScript tourne en CI ; **les runners Swift
  (XCTest) et Kotlin (JUnit) restent à brancher** — limite connue, la parité des
  parsers natifs est aujourd'hui vérifiée à la main.
- **Tests unitaires** : 16 suites, 184 tests (services critiques, parser,
  utilitaires, rendu de l'app).
- **Sentry** en production, avec breadcrumbs sur les flux sensibles.
- **`scan_events`** : qualité réelle de l'OCR sur le parc et taux de repli LLM
  (donc coût unitaire).
- **`scan_failures`** : ce que la télémétrie classique ne voit pas — *un bug
  pouvait toucher tout le parc sans qu'aucune donnée ne le montre*.
- **`scan_debug`** : blocs OCR bruts pour transformer un cas de terrain en
  fixture.
- **Codes d'erreur opaques** `0xC0FEnnnn`, stables, contrat public : le message
  explique, le code sert de référence support et ne révèle rien de l'interne.
- Toute la télémétrie est **fire-and-forget** : une erreur de traçage ne doit
  jamais impacter un scan.
- **Audit technique et sécurité** formel mené en deux passes (28 et 29 juin
  2026), documenté dans `AUDIT_STRIVE_REPORT.md`.

---

## 13. Sécurité et RGPD

| Sujet | Traitement |
|---|---|
| Session | Chiffrée dans le Keychain iOS / Keystore Android |
| Secrets serveur | Clé Gemini, compte de service Firebase, service role : jamais dans le bundle client |
| Base | RLS activée partout, 40 policies, cloisonnement par `auth.uid()` |
| Écriture de télémétrie | Uniquement via RPC `SECURITY DEFINER` |
| Capture d'écran | 100 % en mémoire, jamais persistée |
| Télémétrie produit | Non nominative : tranches de prix, pas d'adresse, pas de coordonnées |
| Droit à l'effacement | RPC `delete_account` en cascade + révocation du jeton Apple |
| Effacement partiel | « Supprimer mon historique », indépendant de la suppression de compte |
| Rétention | Purges automatisées par `pg_cron` (30 j) |
| Transparence | Chaque utilisateur peut lire ses propres `scan_events` |
| Opt-out | Le mode diagnostic est désactivable |
| Documents | `PRIVACY_POLICY.md` / `.en.md`, `TERMS_OF_SERVICE.md` / `.en.md` |

---

## 14. Changements récents (septembre 2026)

Trois évolutions non encore déployées en production, à connaître pour lire le
dépôt correctement :

1. **Clôture hebdomadaire des courses non tranchées**
   (`20260907_weekly_close_pending_rides.sql`). Une course reste « en attente »
   tant que le chauffeur n'a pas décidé ; le **dimanche à 23 h 59 heure locale
   du chauffeur**, les courses non tranchées passent en `DECLINED`, avec un
   filet de sécurité à 7 jours. Le job `pg_cron` tourne toutes les heures, ce
   qui est ce qui permet de respecter chaque fuseau avec un seul job.

2. **`rides.decided_at`** (`20260907_ride_decided_at.sql`). Colonne horodatant
   **le geste du chauffeur**, et lui seul. Elle existe parce que la clôture
   ci-dessus rend `status` ambigu : `DECLINED` recouvre « refusé » et « rien
   tapé ». Le prédicat `decided_at is not null or status = 'ACCEPTED'` isole les
   vraies décisions (`ACCEPTED` n'est jamais posé automatiquement).
   La colonne est écrite par le trigger `stamp_ride_decision`, **pas par le
   client** : la policy `rides_update_own` laisserait un client écrire n'importe
   quelle colonne de ses propres courses, et la valeur serait falsifiable.
   Aucun backfill : l'historique reste à `NULL` plutôt que d'inventer une heure
   de décision jamais enregistrée.

3. **Drapeau `geminiUsed` remonté par le natif.** Le repli LLM n'était mesuré
   que sur le chemin JavaScript, jamais emprunté par les scans réels : `scan_events`
   enregistrait `gemini_fallback = false` sur 100 % des scans — une constante,
   pas une mesure. Le booléen traverse désormais les deux pipelines natifs, le
   journal Android et la relève. Il déclenche aussi la capture de `scan_debug`,
   dont la condition précédente (« une adresse manque ») ne s'est jamais
   vérifiée en production : la table est restée vide depuis sa création, et
   aucun cas de terrain n'a jamais alimenté `fixtures/ocr/`.

> ⚠️ Conséquence : la mesure du repli LLM ne devient fiable **qu'à partir des
> scans effectués avec le nouveau build**. Les payloads déjà en file ne portent
> pas la clé et sont traités comme `false`.

---

## 15. Le site web

`web/` — **Next.js 16** (App Router), React 19, **Tailwind CSS 4**, déployé sur
**Vercel**, connecté à Supabase. Page de liste d'attente avant lancement.

La table `waitlist` n'est **jamais** accessible directement à un visiteur
anonyme : tout passe par la RPC `join_waitlist()` (`SECURITY DEFINER`), qui
valide le format, rejette les emails jetables, déduplique sur l'email normalisé
et renvoie la position dans la file. Lecture réservée aux administrateurs. La
source (`utm_source`), la langue du navigateur et le référent tronqué sont
capturés — de quoi mesurer l'acquisition sans traqueur tiers.

---

## 16. Chiffres du dépôt (07/09/2026)

| Indicateur | Valeur |
|---|---|
| Commits | 221 (premier : 21 février 2026) |
| TypeScript / TSX | ~33 900 lignes (81 + 72 fichiers) |
| Swift | ~7 900 lignes (17 fichiers) |
| Kotlin | ~3 800 lignes (11 fichiers) |
| SQL | ~7 000 lignes |
| **Total code applicatif** | **~52 600 lignes** |
| Écrans / composants / services | 21 / 25 / 16 |
| Migrations · tables · policies RLS · fonctions | 56 · 15 · 40 · 34 |
| Edge functions | 6 |
| Clés de traduction | 967 × 2 langues |
| Langues de détection d'adresse | 6 · Plateformes VTC : 3 · Pays TomTom : 13 |

---

## 17. Pièges de lecture du dépôt

Points où le code induit en erreur si on le lit au premier degré :

- **`src/services/scanner/index.ios.ts`** documente un flux **Share Sheet /
  Share Extension périmé**. Le parcours iOS réel est le **raccourci** :
  `ios/Strive/AppIntents/AnalyzeRideIntent.swift` et les clés `tutorial.*`.
- **`supabase/migrations/20260820_scan_ledger.sql`** décrit une table
  **supprimée** par `20260822`. Elle est conservée parce qu'une migration jouée
  ne se retire pas de l'historique, mais elle n'explique rien du quota actuel.
- **Le commentaire « les courses gardent leur statut »** dans `DashboardScreen`
  décrit la suppression d'une bascule automatique quotidienne (26/08/2026).
  Une clôture **hebdomadaire** la remplace (§14) : ce n'est pas un retour en
  arrière, la fenêtre passe de 24 h à 7 jours et la donnée reste distinguable
  grâce à `decided_at`.
- **`scan_events.addresses_found` vaut toujours 2** : c'est un **biais de
  survie**, la télémétrie ne s'écrivant que quand une course est produite. Le
  vrai indicateur de fiabilité croise `rides` et `scan_failures`.
- **Trois parsers, un seul contrat.** Modifier `ocrParser.ts` sans répercuter
  sur `OcrParser.swift` et `OcrParser.kt` casse la parité en silence — rien ne
  le signale à la compilation, seules les fixtures le voient.
