# Mise en ligne App Store — Strive iOS

Checklist de A à Z, spécifique à ce repo. Coche au fur et à mesure.

Contexte technique constaté :
- Tu développes sous **Windows** → **aucun build local iOS possible**. Tout passe par **EAS Build** (cloud macOS). `eas-cli 19.0.8` est déjà installé.
- L'app existe déjà dans App Store Connect : `ascAppId 6772641578` (voir `eas.json` → `submit.production.ios`).
- Bundle IDs : `com.striveapp.app` (app), `.share` (Share Extension), `.widget` (Widget/Live Activity). Team `Q53DF65NCW`.
- Version marketing `2.4.1` (`app.json` + `MARKETING_VERSION`), build number géré par EAS (`appVersionSource: remote`, `autoIncrement: true`).
- 3 `PrivacyInfo.xcprivacy` déjà en place (app + share + widget). ✅
- `ITSAppUsesNonExemptEncryption = false` déjà déclaré → pas de blocage « Missing Compliance ». ✅

---

## Phase 0 — Nettoyage du code avant build

- [x] ~~**Supprimer `react-native-fbsdk-next`**~~ — fait (dépendance + mock Jest retirés ; `ios/Podfile.lock` sera régénéré par le `pod install` d'EAS)
  Le package est dans `dependencies` mais **aucun import** dans `src/` ni dans le natif iOS. Il est quand même linké dans le binaire.
  Conséquences si tu le laisses : Apple voit le SDK Facebook → tu dois déclarer du *tracking* dans App Privacy, et ajouter `NSUserTrackingUsageDescription` + un prompt ATT, sinon **rejet** (guideline 5.1.2).
  ```bash
  npm uninstall react-native-fbsdk-next
  ```
  Puis vérifier qu'aucun `FacebookAppID` n'est attendu dans `Info.plist` (il n'y en a pas actuellement → l'app crasherait à l'init si le SDK était initialisé).

- [ ] **CarPlay : décider maintenant**
  `ios/Strive/CarPlay/CarPlaySceneDelegate.swift` existe mais n'est **pas déclaré** dans `Info.plist` (pas de `UIApplicationSceneManifest` / `CPTemplateApplicationScene`) et l'entitlement CarPlay n'est pas dans `Strive.entitlements`.
  → Du code mort, inoffensif pour ce build. **Ne l'active pas pour la v1** : l'entitlement CarPlay se demande à Apple via un formulaire et l'accord prend des semaines. Garde-le pour une version ultérieure.

- [ ] **Committer le travail en cours**
  Tu es sur `fix/quota-native-reconciliation` avec ~35 fichiers modifiés et 5 non suivis (`ios/Strive/CarPlay/`, `src/components/ListItemEntrance.tsx`, `src/hooks/useReduceMotion.ts`, 2 migrations SQL).
  ```bash
  git add -A && git commit -m "..." 
  git checkout main && git merge fix/quota-native-reconciliation
  ```
  Builder depuis une branche de travail est possible mais tu ne sauras plus quel commit est en prod.

- [x] ~~**Appliquer les migrations Supabase en production**~~ — fait
  `supabase/migrations/20260816_rides_scan_ts.sql` et `20260817_rides_scan_ts_unique.sql` ne sont pas encore poussées. Le build App Store parlera à la **base prod** → si le schéma manque, l'app est cassée pour le reviewer.
  ```bash
  npx supabase db push --linked
  ```

- [ ] **Vérifs automatiques** (déjà OK au moment de l'écriture)
  ```bash
  npx tsc --noEmit    # ✅ 0 erreur
  npm test            # ✅ vert
  npm run lint
  ```

---

## Phase 1 — Comptes et prérequis

- [ ] **Apple Developer Program** actif (99 $/an) — vérifier la date d'expiration, un compte expiré bloque tout build/soumission.
- [ ] **Contrats App Store Connect** : dans *Business* → *Agreements*, le **Paid Applications Agreement** doit être `Active`. Sans lui, **aucun achat in-app ne fonctionne** et l'app peut être rejetée. C'est l'oubli n°1.
  - Coordonnées bancaires + informations fiscales remplies et validées.
- [ ] **Identité vérifiée** (Apple demande de plus en plus une vérification D-U-N-S / identité pour les nouveaux comptes).

---

## Phase 2 — Achats in-app (RevenueCat)

Suivre `docs/REVENUECAT_SETUP.md`. Points bloquants :

- [ ] Les produits d'abonnement existent dans App Store Connect, avec statut **« Ready to Submit »** (pas « Missing Metadata »).
- [ ] Chaque produit a : prix, localisations (fr + en), **screenshot de review** et **notes de review**.
- [ ] Le **groupe d'abonnement** a un nom localisé.
- [ ] Les produits sont **attachés à la version** que tu soumets (section *In-App Purchases* de la page de version) — pour la **première** soumission, ils doivent être soumis **en même temps** que le binaire, sinon ils restent bloqués.
- [ ] RevenueCat : offering `current` configuré, produits liés, **App Store Connect App-Specific Shared Secret** renseigné dans le dashboard RevenueCat.
- [ ] Webhook RevenueCat → Supabase fonctionnel.

- [ ] ⚠️ **`REVENUECAT_ALLOW_SANDBOX` doit rester à `true` pendant la review.**
  `supabase/functions/revenuecat-webhook/index.ts:26` ignore les events `SANDBOX` quand le flag est absent. **Le reviewer Apple achète en sandbox** → sans ce flag, son achat ne débloque pas le premium et tu te fais **rejeter pour « bug / achat non fonctionnel »**.
  → Le passer à `false` **seulement après** que l'app soit approuvée **et** publiée. Note-le, c'est un piège à retardement.

- [ ] **Bouton « Restaurer les achats »** visible et fonctionnel dans l'app (obligatoire, guideline 3.1.1).
- [ ] Le **paywall** affiche : prix, durée de la période, ce que contient l'abonnement, **liens vers CGU et politique de confidentialité** (obligatoire, guideline 3.1.2).

---

## Phase 3 — Configuration EAS ✅ (déjà opérationnelle)

Vérifié : compte `rayane2677` / projet `@rayane2677s-organization/strive`, et le **build iOS production n°67 a réussi** le 17/08/2026 depuis le commit `6903678`. Toute la chaîne (credentials, provisioning des 3 bundle IDs, secrets) est donc **déjà prouvée fonctionnelle**. Rien à refaire ici.

- [x] Connecté (`eas whoami` → `rayane2677`)
- [x] Credentials iOS : validés implicitement par les builds `store` réussis (65, 66, 67)
- [x] Secrets : le profil `production` n'expose que `SENTRY_AUTH_TOKEN` et `STRIVE_ENV_FILE`.
      `STRIVE_ENV_FILE` est un **file secret** contenant tout le `.env`, restauré au build par
      `scripts/eas-build-pre-install.js`. Le `.env` local (9 clés, toutes remplies) date du **27/07/2026**.
      ⚠️ Si tu as changé une clé depuis, re-pousse le fichier :
      ```bash
      npx eas env:update --scope project --environment production \
        --name STRIVE_ENV_FILE --type file --visibility secret --value ./.env
      ```
- [x] Build number distant : **67** → le prochain build sera le **68** (auto-incrémenté)

Note : `REVENUECAT_SECRET_API_KEY` est présent dans le `.env` mobile alors qu'il ne sert qu'à
l'edge function Supabase (`revenuecat-webhook/index.ts:31`). Ce n'est **pas** une fuite —
`react-native-dotenv` n'inline que les variables réellement importées depuis `@env`, et
aucune n'importe celle-ci. À nettoyer un jour par hygiène, pas urgent.

- [ ] **Version**
  `app.json` → `"version": "2.4.1"`. C'est le numéro que verront les utilisateurs. Si c'est ta **première** mise en ligne publique, `2.4.1` est parfaitement acceptable (les versions précédentes étaient internes) — ou repasse à `1.0.0` si tu préfères. Le build number est incrémenté automatiquement par EAS.

---

## Phase 4 — Build et TestFlight

- [ ] **Lancer le build de production**
  ```bash
  npx eas build --platform ios --profile production
  ```
  Compte 20–40 min. Le lien de suivi s'affiche dans le terminal.

- [ ] **Envoyer sur App Store Connect**
  ```bash
  npx eas submit --platform ios --profile production --latest
  ```
  (`ascAppId` est déjà dans `eas.json`.) Il te demandera un mot de passe d'application ou une clé API App Store Connect — crée une **clé API** (*Users and Access* → *Integrations* → *App Store Connect API*, rôle *App Manager*), c'est plus fiable que le mot de passe.

- [ ] **Attendre le traitement** (10–60 min), puis dans TestFlight :
  - Remplir le **questionnaire Export Compliance** si demandé (réponse : pas de chiffrement non exempt).
  - Installer sur un **iPhone physique** et tester **en conditions réelles**.

- [ ] **Tests obligatoires sur le build TestFlight** (pas sur le simulateur) :
  - [ ] Inscription + connexion : email, **Sign in with Apple**, Google
  - [ ] **Suppression de compte depuis l'app** — obligatoire (guideline 5.1.1(v)) dès qu'on peut créer un compte. Vérifie que le chemin existe et fonctionne réellement.
  - [ ] Achat d'abonnement en sandbox → premium débloqué → **restauration** sur un second appareil
  - [ ] Scanner : Share Extension depuis une capture d'écran, OCR, fallback Gemini
  - [ ] Live Activity : démarrage, mise à jour, fin, affichage Dynamic Island
  - [ ] Widget
  - [ ] Notifications push (autorisation + réception)
  - [ ] Mode hors-ligne puis resynchronisation
  - [ ] Les deux langues (fr / en)
  - [ ] Premier lancement **sur un compte vierge** — c'est ce que verra le reviewer

---

## Phase 5 — Fiche App Store Connect

Dans App Store Connect → ton app → version 2.4.1.

- [ ] **Nom** (30 car.) et **sous-titre** (30 car.)
- [ ] **Description** — décris ce que fait l'app sans promettre de revenus garantis
- [ ] **Mots-clés** (100 car., séparés par des virgules, sans espaces) — ⚠️ ne mets **pas** « Uber », « Bolt », « Heetch » : utiliser des marques tierces en mots-clés est un motif de rejet fréquent
- [ ] **Captures d'écran** — obligatoires : **6,9"** (1290×2796) et **6,5"** (1242×2688). Pas de captures iPad à produire : l'app est passée en **iPhone only** (`TARGETED_DEVICE_FAMILY = "1"`). ✅
  Ne montre **pas** l'interface d'Uber/Bolt dans les captures.
- [ ] **Icône 1024×1024** — présente dans le bundle (`Icon-1024.png`) ✅, sans transparence ni coins arrondis
- [ ] **Catégorie** : Business ou Finance
- [ ] **URL de politique de confidentialité** et **URL des CGU** — tu as `PRIVACY_POLICY.md` / `TERMS_OF_SERVICE.md` (+ versions `.en`), il faut qu'ils soient **publiés sur une URL publique** (le dossier `web/` sert peut-être déjà à ça — vérifier que les pages sont en ligne)
- [ ] **URL de support** (page ou email joignable)
- [ ] **Classification par âge** (questionnaire)
- [ ] **Copyright**, **coordonnées** (nom, téléphone, email joignables — Apple appelle parfois)

- [ ] **App Privacy** (section *Privacy* de l'app, séparée de la version) — à remplir en cohérence avec les `PrivacyInfo.xcprivacy`. Pour Strive, typiquement :
  - Identifiants (user ID) — lié à l'utilisateur, pour le fonctionnement de l'app
  - Coordonnées (email) — lié
  - Données d'utilisation / diagnostics (Sentry) — lié ou non selon ta config
  - Localisation approximative si les adresses de course sont stockées
  - **Aucun tracking** (une fois `fbsdk` retiré)
  Toute incohérence entre ce formulaire et ce que fait réellement l'app = rejet.

- [ ] **Notes pour le reviewer** — champ crucial pour Strive. Rédige quelque chose comme :
  ```
  Compte de test : review@strive.app / [mot de passe]
  Ce compte a déjà un abonnement actif ; pour tester le paywall,
  créez un nouveau compte.

  Strive est un outil de suivi de revenus pour chauffeurs VTC indépendants.
  L'utilisateur partage manuellement une capture d'écran de sa course
  (via la feuille de partage iOS) ; l'app en extrait le prix, la distance
  et la durée par OCR sur l'appareil, puis calcule sa rentabilité.
  L'app ne se connecte à aucune plateforme tierce, n'automatise rien
  et ne lit aucun écran automatiquement.

  L'extension de partage se teste depuis Photos > une capture d'écran
  > bouton Partager > Strive.
  ```
- [ ] **Compte de démonstration** : renseigne un identifiant/mot de passe qui marche. Un reviewer bloqué à l'écran de connexion = rejet automatique.
- [ ] **Sélectionner le build** TestFlight dans la section *Build*.
- [ ] **Mise à disposition** : choisis « **Publier manuellement** » plutôt qu'automatique — ça te laisse le contrôle de la date de sortie une fois approuvé.

---

## Phase 5 bis — Exigences de review déjà satisfaites (vérifié dans le code)

Ces points sont les motifs de rejet classiques ; ils sont **déjà en place**, inutile d'y retoucher :

- [x] **Suppression de compte dans l'app** (guideline 5.1.1(v)) — `src/screens/ProfileScreen.tsx:75`, avec confirmation par saisie et RPC `delete_account`, plus purge de l'avatar dans Storage avant suppression.
- [x] **Restaurer les achats** (guideline 3.1.1) — `src/services/iapService.ts:268`, avec timeout de 15 s, exposé dans `SubscriptionScreen`.
- [x] **Liens légaux sur le paywall** (guideline 3.1.2) — `SubscriptionScreen.tsx:540-545` → `striveapp.fr/terms` et `striveapp.fr/privacy`, **les deux pages sont bien en ligne** (vérifié, maj 13/06/2026).
- [x] **Lien vers la gestion de l'abonnement Apple** — `SubscriptionScreen.tsx:235`.
- [x] **iPhone only** — `TARGETED_DEVICE_FAMILY = "1"` sur les 3 targets, et clé `UISupportedInterfaceOrientations~ipad` retirée de l'`Info.plist`.

---

## Phase 6 — Risques de review propres à Strive

À anticiper, ce sont les points sur lesquels ton app peut se faire retoquer :

1. **Marques tierces (Uber, Bolt, Heetch)** — guideline 5.2.1. Ne les utilise ni dans le nom, ni dans les mots-clés, ni dans les captures, ni comme logos dans l'app. Formule tout en « plateformes VTC ».
2. **Achats in-app non fonctionnels pour le reviewer** — voir le point `REVENUECAT_ALLOW_SANDBOX` en Phase 2. C'est ton risque le plus concret.
3. **Suppression de compte manquante** — guideline 5.1.1(v). Vérifie que le chemin existe vraiment dans l'app.
4. **Share Extension** — si le reviewer ne comprend pas comment l'utiliser, il conclura que la fonction principale ne marche pas. D'où les notes de review détaillées.
5. **Accès aux photos** — ta `NSPhotoLibraryUsageDescription` mentionne les captures. Assure-toi que l'usage réel colle exactement à la phrase affichée.
6. **Expo Updates (OTA)** — l'app a les mises à jour OTA activées côté Android ; côté iOS, si `expo-updates` est actif, tu as le droit de pousser du JS mais **pas** de changer les fonctionnalités décrites dans la fiche (guideline 2.5.2). Ne pousse pas de nouvelle feature par OTA.

---

## Phase 7 — Soumission et publication

- [ ] Cliquer **« Add for Review »** → **« Submit to App Review »**.
- [ ] Délai typique : **24 à 48 h**. Réponds vite à toute question dans le *Resolution Center* — chaque échange relance le compteur.
- [ ] En cas de rejet : lis la guideline citée, corrige, réponds dans le Resolution Center (souvent une explication suffit, sans nouveau build).
- [ ] Une fois **« Pending Developer Release »** → publier quand tu es prêt.
- [ ] Après publication : compter jusqu'à 24 h pour la propagation mondiale sur l'App Store.

---

## Phase 8 — Après la mise en ligne

- [ ] **Passer `REVENUECAT_ALLOW_SANDBOX` à `false`** en production (une fois l'app publiée et un vrai achat vérifié), sinon un achat sandbox gratuit peut débloquer le premium.
- [ ] Vérifier que **Sentry** remonte bien les crashs du build de production (source maps uploadées par le build EAS).
- [ ] Surveiller les **avis** et **App Store Connect → Analytics** les premiers jours.
- [ ] Poser un **tag git** sur le commit exact qui a été buildé :
  ```bash
  git tag -a ios-v2.4.1 -m "App Store 2.4.1" && git push --tags
  ```
- [ ] Préparer un build de correctif rapide au cas où — le premier vrai trafic révèle toujours quelque chose.

---

## Récapitulatif des commandes

```bash
# Vérifications
npx tsc --noEmit && npm test && npm run lint

# Base de données
npx supabase db push --linked

# EAS
npx eas login
npx eas env:list --environment production
npx eas credentials -p ios
npx eas build   --platform ios --profile production
npx eas submit  --platform ios --profile production --latest
```
