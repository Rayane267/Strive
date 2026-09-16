# Strive

Application mobile React Native (iOS & Android) pour chauffeurs VTC — scanner de courses, suivi des revenus, analytics et gestion de profil.

## Stack technique

- **Framework** : React Native 0.84 / React 19 / TypeScript
- **Navigation** : React Navigation (native-stack + bottom-tabs)
- **Backend** : Supabase (auth, database, edge functions)
- **Auth** : Supabase Auth + Google Sign-In + Apple Authentication
- **Paiements** : RevenueCat (react-native-purchases)
- **Notifications** : Firebase Cloud Messaging
- **Monitoring** : Sentry
- **Cartes / géolocalisation** : TomTom API
- **i18n** : i18next (fr/en)
- **Tests** : Jest + React Test Renderer

## Structure du projet

```
src/
├── components/      # Composants UI réutilisables
├── context/         # AuthContext (auth state global)
├── hooks/           # Custom hooks (useOfflineSync, …)
├── i18n.ts          # Configuration i18next
├── locales/         # Traductions (en.json, fr.json)
├── navigation/      # RootNavigator, TabNavigator
├── screens/         # Écrans de l'app
├── services/        # Services métier (supabase, scanner, IAP, offline, …)
├── theme/           # Palette de couleurs
├── types/           # Définitions TypeScript
└── utils/           # Utilitaires
supabase/functions/  # Edge functions Supabase (gemini-proxy)
```

## Commandes

```bash
# Installer les dépendances
npm install

# Lancer Metro bundler
npm start

# Build & run
npm run android
npm run ios

# Tests
npm test

# Lint
npm run lint
```

## Configuration

Copier `.env.example` en `.env` et renseigner les clés :
- `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_KEY`
- `REVENUECAT_API_KEY_ANDROID` / `REVENUECAT_API_KEY_IOS`
- `TOMTOM_API_KEY`
- `SENTRY_DSN`
- `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_IOS_CLIENT_ID`

## Conventions

- Node >= 22.11.0
- Prettier (2.8.8) pour le formatage
- ESLint avec la config React Native
- Les tests unitaires des services sont dans `src/services/__tests__/`
- Les patches de dépendances sont dans `patches/` (appliquées via `patch-package` au postinstall)

## Style de collaboration (token frugality)

- Pas de récaps après les edits — le diff suffit.
- Pas de tests unitaires ajoutés sans demande explicite.
- Pas de logs/diagnostic ajoutés "au cas où" — attendre le signal utilisateur.
- Lire en ciblé avec `offset`/`limit` ; éviter de relire tout un fichier.
- Déléguer les gros grep (>3 queries) à un subagent Explore.
- Appels d'outils indépendants en parallèle, pas en série.
- Réponses courtes : 1 phrase de statut avant un tool call, pas de préambule.
