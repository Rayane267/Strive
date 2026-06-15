# Contexte de l'application Strive — document pour mémoire M2

> Document de synthèse destiné à donner à un assistant IA (ou à un lecteur) une
> compréhension complète de l'application **Strive**, sans avoir à lire le code
> source. Rédigé à partir du dépôt réel. À téléverser dans la knowledge base
> d'un Projet Claude aux côtés des guidelines de l'école.

---

## 1. Présentation générale

**Strive** est une application mobile (iOS & Android) destinée aux **chauffeurs
VTC** (Uber, Bolt, Heetch). Elle répond à un problème concret du métier : sur
ces plateformes, le chauffeur doit décider en quelques secondes s'il accepte ou
refuse une course, à partir d'une offre affichée à l'écran (prix, distance,
adresses). Il manque d'outils pour savoir si une course est *réellement*
rentable une fois le carburant, la distance d'approche et le temps déduits.

Strive permet de :

1. **Scanner** l'écran d'offre de course (capture d'écran ou photo) pour en
   extraire automatiquement les données (prix, distance, durée, adresses).
2. **Calculer la rentabilité** réelle de la course (€/h, €/km, marge après
   carburant).
3. **Suivre ses revenus** dans le temps via des analytics et un historique.
4. **Gérer son profil** chauffeur (véhicule, consommation, préférences).

Le modèle économique repose sur un **abonnement freemium** (free / plus /
premium) avec crédits de scan, géré via RevenueCat.

---

## 2. Proposition de valeur

| Problème du chauffeur VTC | Réponse de Strive |
|---|---|
| Décider vite si une course est rentable | Scan instantané + calcul €/h et €/km |
| Coût réel masqué (carburant, approche) | Déduction du carburant via prix carburant + conso véhicule |
| Pas de suivi consolidé multi-plateformes | Historique et analytics unifiés Uber/Bolt/Heetch |
| Connexion réseau instable en voiture | Mode hors-ligne (consultation + synchro différée) |

---

## 3. Stack technique

- **Framework** : React Native 0.84 / React 19 / TypeScript
- **Langages natifs** : Swift/Objective-C (iOS), Kotlin (Android) pour le module
  de scan OCR
- **Navigation** : React Navigation (native-stack + bottom-tabs)
- **Backend** : Supabase (authentification, base PostgreSQL, edge functions)
- **Authentification** : Supabase Auth + Google Sign-In + Apple Authentication
- **Paiements / abonnements** : RevenueCat (`react-native-purchases`)
- **OCR** : ML Kit (Android) et Vision framework (iOS), en natif
- **Fallback IA** : Google Gemini (1.5 Flash) via une edge function Supabase
- **Notifications** : Firebase Cloud Messaging + notifications locales
- **Monitoring** : Sentry
- **Cartes / géolocalisation** : API TomTom
- **Internationalisation** : i18next (français / anglais)
- **Stockage local** : AsyncStorage (cache offline) + Keychain (secrets)
- **Tests** : Jest + React Test Renderer

---

## 4. Architecture logicielle

L'application suit une séparation claire **UI / logique métier / accès données** :

```
src/
├── components/   Composants UI réutilisables (+ ErrorBoundary par écran)
├── context/      AuthContext — état d'authentification global
├── hooks/        Hooks personnalisés (ex. synchro offline)
├── navigation/   RootNavigator (stack) + TabNavigator (onglets)
├── screens/      Écrans de l'application (~15)
├── services/     Logique métier (scanner, supabase, IAP, offline, …)
├── types/        Définitions TypeScript (modèle de données)
├── locales/      Traductions fr/en
└── theme/        Palette de couleurs
supabase/functions/   Edge functions serveur (gemini-proxy, webhooks, …)
```

### Choix d'architecture notables (intéressants pour le mémoire)

- **Logique de parsing centralisée** : l'OCR est exécuté en natif (ML Kit /
  Vision pour la performance), mais la *logique d'interprétation* des textes
  extraits vit dans un seul fichier TypeScript partagé Android/iOS
  (`ocrParser.ts`). Un seul endroit à maintenir → cohérence garantie entre les
  deux plateformes.
- **ErrorBoundary par écran** : chaque écran est isolé dans sa propre frontière
  d'erreur pour qu'un crash local ne fasse pas planter toute l'application.
- **Remote config** : certains paramètres de parsing (mots-clés de prix, etc.)
  sont conçus pour être patchés via Supabase sans republier l'app sur les
  stores.
- **Secrets côté serveur** : la clé API Gemini ne se trouve jamais dans le
  bundle client ; les appels passent par une edge function Supabase
  (`gemini-proxy`).

---

## 5. Fonctionnalité phare : le scanner OCR (pipeline à 2 niveaux)

C'est le cœur technique de l'app et probablement le sujet central du mémoire.

**Niveau 1 — OCR natif + parsing local (rapide, gratuit, hors-ligne) :**
1. L'utilisateur capture l'écran d'offre de course.
2. Le module natif extrait les blocs de texte (ML Kit sur Android, Vision sur
   iOS).
3. Ces blocs sont envoyés via un *bridge* au parser TypeScript partagé.
4. Le parser identifie la plateforme (Uber/Bolt/Heetch), puis extrait prix,
   distance, durée et adresses à l'aide d'expressions régulières et d'ancres
   sémantiques multilingues (FR, EN, ES, IT, NL, PT).

**Niveau 2 — Fallback LLM (robustesse) :**
- Si le parsing local échoue (résultat nul ou valeurs aberrantes hors bornes
  réalistes : tarif 5–200 €, distance 0,3–500 km), l'image compressée est
  envoyée à **Gemini 1.5 Flash** via l'edge function Supabase, avec un prompt
  métier strict qui impose les règles d'extraction (ordre des adresses, formats
  de prix avec virgule décimale, distinction adresse / ligne statistique).
- Gemini renvoie un JSON structuré, validé puis utilisé comme résultat.

**Défis techniques traités (matière pour le mémoire) :**
- Robustesse OCR : espaces parasites (`17 , 18 €`), séparateurs variés,
  mode sombre Uber sans le mot « Uber » → détection par tournures de phrase.
- Multilingue : mots-clés de voie et d'ancrage de prix dans 6 langues.
- Distinction adresse réelle vs. ligne statistique (« Course de 11.8 km »).
- Compromis coût/latence/précision entre parsing local et appel LLM.

---

## 6. Modèle de données (Supabase / PostgreSQL)

Deux entités principales.

### Profil chauffeur (`profiles`)
- Identité : prénom, nom, email, téléphone, date de naissance, avatar
- Statut : en ligne / hors ligne
- **Abonnement** : palier (`free` / `plus` / `premium`), statut (`active`,
  `in_grace_period`, `expired`, `cancelled`, `paused`), date d'expiration,
  identifiant produit, crédits de scan supplémentaires
- **Véhicule** : marque, modèle, année, immatriculation, type de carburant,
  consommation moyenne (sert au calcul de rentabilité)

### Course (`rides`)
- Plateforme (Uber / Bolt / Heetch)
- Statut : `PENDING` / `ACCEPTED` / `DECLINED`
- Tarif estimé (issu du scan) vs. tarif final (confirmé par le chauffeur)
- Distance (km), durée (min)
- Taux calculés : €/h, €/km
- Adresses de départ et de destination
- Date de création

> Le « tarif effectif » utilisé pour les statistiques est le tarif final s'il a
> été confirmé, sinon le tarif estimé.

---

## 7. Fonctionnement hors-ligne

Les chauffeurs travaillent souvent en zone de réseau instable. Strive met en
cache via AsyncStorage les courses, les statistiques et les préférences pour
permettre la **consultation sans connexion**. Le cache est versionné : un
changement de version vide automatiquement les données obsolètes pour éviter les
erreurs de lecture. Les données créées hors-ligne sont synchronisées une fois la
connexion rétablie.

---

## 8. Monétisation

- **Freemium** géré par **RevenueCat** (`react-native-purchases`).
- Trois paliers : `free`, `plus`, `premium`.
- Système de **crédits de scan** (`extra_scan_credits`) pour limiter/débloquer
  l'usage du scanner.
- Un **webhook RevenueCat** (edge function Supabase) synchronise l'état
  d'abonnement côté serveur (achat, renouvellement, expiration…).

---

## 9. Écrans principaux (parcours utilisateur)

- **Auth** : connexion / inscription (email, Google, Apple)
- **Tutorial / ProfileSetup** : onboarding première utilisation
- **Dashboard** : écran principal, déclenche le scan et affiche le résultat
- **Analytics** : visualisation des revenus et statistiques
- **History** : historique des courses scannées
- **Profile / AccountInfo / CarSettings / Preferences** : gestion du compte et
  du véhicule
- **Subscription / Shop** : abonnement et achat de crédits
- **Help / ScannerPermission / ResetPassword** : support et utilitaires

---

## 10. Qualité et industrialisation

- **Tests unitaires** Jest sur les services critiques (scanner, abonnements,
  rides, offline, TomTom, notifications…), avec des *fixtures OCR partagées* pour
  garantir un contrat commun entre les parsers iOS, Android et TS.
- **Monitoring** Sentry (suivi des erreurs en production).
- **CI/CD** : builds via EAS, scripts pre/post-install.
- **Patches de dépendances** versionnés (`patches/`, appliqués au postinstall).
- **i18n** complet français / anglais.
- **Conventions** : Node ≥ 22.11, Prettier, ESLint (config React Native).

---

## 11. Pistes d'angles pour le mémoire

Selon l'orientation choisie, les sujets les plus riches dans ce projet :

- **Technique** : architecture cross-platform avec logique métier partagée et
  OCR natif ; pipeline OCR hybride local + LLM (compromis coût/précision/latence).
- **Produit / entrepreneurial** : identification d'un besoin métier non couvert,
  modèle freemium, calcul de rentabilité comme proposition de valeur.
- **Méthodologie** : tests par fixtures partagées, monitoring, gestion offline,
  parité iOS/Android.
