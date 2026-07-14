# 🏎️ Audit technique & sécurité — Strive

> Audit réalisé en tant que Lead Staff Engineer / Auditeur Sécurité.
> Périmètre : React Native (TS), bridge natif Swift (iOS) **et Kotlin (Android)**, backend Supabase (RLS + edge functions).
> Date : 2026-06-28 · 2ᵉ passe : 2026-06-29 · Branche : `fix/quota-native-reconciliation` · Commit : `f79c31f`

> **Une 2ᵉ passe complète a été menée** (edge function `fuel-prices`, durcissement SQL, anti-abus, IAP/RevenueCat, quotas DB, et tout le natif **Android**). Voir la section [« Seconde passe »](#-seconde-passe-2026-06-29) en fin de document : elle confirme les correctifs et ajoute 4 découvertes.

---

## Synthèse exécutive

Strive est une base **nettement au-dessus de la moyenne** des apps RN à ce stade : RLS complète et correcte, edge functions durcies (rate-limit + budget global + fail-closed), stockage de session chiffré (Keychain/Keystore), traitement d'image **100 % en mémoire** (pas de capture persistée sur disque → conforme RGPD par design), et des patterns de robustesse natifs soignés (watchdog anti-deadlock, mutex de sync offline, idempotence webhook).

Les points à corriger relèvent surtout de **trous fonctionnels/RGPD ponctuels** (suppression de compte incomplète, deadlock latent dans un helper OCR) et de **dette de duplication** côté Swift. Aucune faille d'architecture majeure, aucun secret applicatif en dur exploitable.

| Sévérité | Nombre | Thème dominant |
|----------|--------|----------------|
| 🔴 Critique | 2 | Suppression de compte (RGPD) · deadlock OCR latent |
| 🟠 Avertissement | 7 | RLS manquante `fuel_prices` · re-renders globaux · duplication Swift |
| 🔵 Reco architecture | 5 | Cascade FK · découpage écrans · mutualisation natif |
| 🟢 Points forts | 8 | RLS · proxy Gemini · privacy by design |

### État des correctifs (post-audit)

| ID | Statut |
|----|--------|
| 🔴 C1 — `delete_account()` cascade RGPD | ✅ Corrigé, déployé et testé (migration `20260629_fix_delete_account_cascade.sql`) |
| 🔴 C2 — Deadlock `recognizeTextSync` | ✅ Corrigé (`VisionOCRService.swift`, effectif au prochain build) |
| 🟠 W7 — RLS manquante sur `fuel_prices` | ✅ Migration créée (`20260629_fuel_prices_rls.sql`), à déployer |
| 🟠 W1 — `AuthContext` non mémoïsé | ✅ Corrigé (`useMemo` + `useCallback`, typecheck OK) |
| 🔵 Reco — référence morte `cars` | ✅ Guardée par `to_regclass` dans `20260425_rls_policies.sql` (replay propre) |

---

## 🔴 Critique (Urgent)

### C1 — `delete_account()` : cascade incomplète → suppression cassée et/ou données personnelles orphelines (RGPD)

**Fichier :** `supabase/migrations/20260425_delete_account_rpc.sql:21-27`

La RPC ne supprime que `rides`, `preferences`, `profiles`, puis `auth.users` :

```sql
delete from public.rides where user_id = uid;
delete from public.preferences where id = uid;
delete from public.profiles where id = uid;
delete from auth.users where id = uid;   -- ⚠️
```

Or les FK `ON DELETE CASCADE` vers `auth.users` sont **restées en TODO commenté** dans `20260425_rls_policies.sql:210-235`. Deux issues selon l'état réel des contraintes (les tables `cars` / `online_sessions` sont créées hors migrations, donc non auditables ici) :

- **Si les FK n'ont pas de cascade** → `delete from auth.users` lève une **violation de FK** : la suppression de compte **échoue intégralement**. Bug fonctionnel bloquant + non-conformité « droit à l'effacement ».
- **Si les FK sont `ON DELETE SET NULL`** (cas avéré de `scan_debug`, `scan_events`, `audit_log`) → les lignes **persistent avec leurs données personnelles** (adresses dans `scan_debug.blocks`) après suppression, jusqu'à la purge 30 j. Le compte est « supprimé » mais les adresses du chauffeur survivent.

**Tables non couvertes :** `cars`, `online_sessions`, `scan_debug`, `scan_events`, `audit_log`.

**Correctif recommandé :** soit activer les FK `ON DELETE CASCADE` (décommenter le bloc bonus de `rls_policies.sql`), soit compléter la RPC explicitement, et pour `scan_debug` faire un `DELETE` (pas `SET NULL`) sur `user_id = uid` car les blocs contiennent des adresses :

```sql
delete from public.scan_debug      where user_id = uid;
delete from public.online_sessions where user_id = uid;
delete from public.cars            where user_id = uid;
-- puis rides / preferences / profiles / auth.users
```

> À vérifier en priorité : exécuter `delete_account()` sur un compte de test ayant ≥1 véhicule et ≥1 session, et confirmer 0 erreur + 0 ligne résiduelle.

---

### C2 — Deadlock + fuite de thread dans `VisionOCRService.recognizeTextSync`

**Fichier :** `ios/Strive/ScanBridge/VisionOCRService.swift:100-143`

```swift
let semaphore = DispatchSemaphore(value: 0)
...
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])   // ⚠️ si perform throw → closure jamais appelée
semaphore.wait()                  // ⚠️ signal() jamais émis → attente INFINIE
```

Si `handler.perform` lève (image corrompue, mémoire, format non supporté), le `try?` avale l'erreur, la closure (et donc `semaphore.signal()` dans son `defer`) **n'est jamais exécutée**, et `semaphore.wait()` **bloque le thread à vie**. Sur des images répétées/lourdes, c'est un **leak de threads** cumulatif et un hang du contexte appelant (Share Extension, mémoire ~120 Mo plafond → kill).

**Correctif :** signaler le sémaphore dans le `catch`, ou ajouter un `wait(timeout:)` :

```swift
do { try handler.perform([request]) } catch { semaphore.signal() }
_ = semaphore.wait(timeout: .now() + 15)
```

> Note : le chemin de production principal passe par `ScanProcessor.runOcr` (asynchrone, géré par `CompletionGuard` + watchdog — robuste). `recognizeTextSync` semble peu/plus appelé, ce qui réduit l'exposition, mais le code reste un piège. À corriger ou supprimer.

---

## 🟠 Avertissements (Dette technique & perf)

### W1 — `AuthContext` : value non mémoïsée → re-renders globaux

**Fichier :** `src/context/AuthContext.tsx:164-168`

L'objet passé au `Provider` est recréé à **chaque** render de `AuthProvider` :

```tsx
<AuthContext.Provider value={{ user, session, profile, loading, ... }}>
```

Comme `useAuth()` est consommé dans la quasi-totalité des écrans, **toute** mise à jour d'état du provider (ex. `loading`, `setSession` sur `TOKEN_REFRESHED` ~1×/h, `markSubscribed`) force un re-render de tout le sous-arbre abonné. À encapsuler dans un `useMemo` + stabiliser `refreshProfile`/`markSubscribed` (`useCallback`).

### W2 — Duplication massive du code natif Swift (risque de dérive)

Plusieurs blocs critiques sont **copiés-collés** entre targets (faute de target membership Xcode partagé, explicitement noté dans le code) :

- `GeminiVisionServiceLight` (`ShareViewController.swift:844-976`) duplique `GeminiVisionService.swift` (prompt, auth bearer, parsing, bornes sanity).
- Le prompt Gemini existe en **3 exemplaires** (app, extension, et `geminiFallback.ts`).
- `currentQuotaDay` / `scanCountForToday` / `incrementScanCount` dupliqués dans `ScanBridgeModule`, `ShareViewController`, `AnalyzeRideIntent`.

Chaque modif (bornes de validation, format payload, calcul quota) doit être répercutée à 3 endroits → bug latent garanti à terme. **Reco :** ajouter le target membership `StriveShareExtension` aux fichiers `ScanBridge/*.swift` et `Scanner/*.swift`, puis supprimer les copies (le code lui-même documente déjà ce « FIX DÉFINITIF ATTENDU »).

### W3 — Webhook RevenueCat : comparaison de token non constante (timing attack)

**Fichier :** `supabase/functions/revenuecat-webhook/index.ts:79`

```ts
if (!WEBHOOK_AUTH || authHeader !== expected) { ... }
```

`!==` court-circuite au premier octet divergent → fuite temporelle théorique sur le secret. Risque faible (token aléatoire fort), mais correctif trivial : comparaison à temps constant (longueur + XOR cumulatif). Idem `gemini-proxy` pour `token === SUPABASE_ANON_KEY`.

### W4 — `ScanProcessor.scanInProgress` non atomique

**Fichier :** `ios/Strive/Scanner/ScanProcessor.swift:21,62-67`

Le flag est lu/écrit depuis plusieurs threads (callback Vision en background, watchdog sur global queue) sans synchronisation. `CompletionGuard` protège bien le **callback unique**, mais une course exacte entre deux `process()` pourrait laisser passer un second scan. Sérialiser via le même `NSLock` que le guard, ou une serial queue dédiée.

### W5 — `DashboardScreen.tsx` monolithique (1 939 lignes)

Écran unique mêlant état de session, liste de courses en attente, modales de prix, réconciliation des décisions natives, sync offline. Difficile à tester/maintenir et propice aux re-renders larges. La liste `pendingRides.map(...)` dans un `ScrollView` (`:1327`) reste acceptable tant que la liste du jour est courte, mais l'écran gagnerait à être découpé en sous-composants `memo`. (À l'inverse, `HistoryScreen` utilise correctement `FlatList` — bon réflexe.)

### W6 — `LiveActivityManager` : `staleDate` de 8 h sur l'état idle

**Fichier :** `ios/Strive/LiveActivity/LiveActivityManager.swift:88,222,276`

Pas un drain batterie (les updates sont **événementiels**, pas en polling — c'est bien), mais une Live Activity « idle » maintenue 8 h occupe un slot et reste visible longtemps. RAS sur la conso ; vérifier surtout que `stop()` est bien appelé en fin de session côté JS pour éviter une carte fantôme persistante. Comportement actuel correct, à surveiller en QA terrain.

---

### W7 — RLS désactivée sur `fuel_prices` (intégrité multi-utilisateurs)

**Découvert en validation** · table `public.fuel_prices` marquée `UNRESTRICTED` dans Supabase.

La table n'avait **aucune RLS** : tout porteur de la clé anon pouvait `INSERT`/`UPDATE`/`DELETE` le prix du carburant (ligne `paris`). Ce prix étant figé dans chaque course au scan (`fuel_cost` / `net_profit`), un utilisateur pouvait **corrompre le coût carburant de tous les chauffeurs**. Le client ne fait que lire (`fuelService.fetchFuelPrice`).

**Correctif :** migration `20260629_fuel_prices_rls.sql` — RLS activée, `select` public authentifié, aucune écriture client (l'edge function `fuel-prices` écrit en `service_role`, qui bypasse la RLS). Aligné sur le modèle `parser_config` / `vehicles_db`.

---

## 🔵 Recommandations architecturales

1. **Contraintes FK explicites.** Sortir les `ON DELETE CASCADE` du commentaire et les appliquer en migration versionnée (plutôt que via Dashboard) — cela règle C1 à la racine et rend la suppression de compte triviale et fiable.
2. **Schéma versionné complet.** `cars` et `online_sessions` sont créées hors `migrations/` : impossible d'auditer leurs contraintes. Rapatrier *toutes* les DDL en migrations pour reproductibilité et revue.
3. **Mutualiser le natif** (cf. W2) : un seul module Swift partagé entre app / extension / intent. Gain net en sécurité (un seul endroit pour les bornes de validation et l'auth).
4. **Découper `DashboardScreen`** en `SessionHeader`, `PendingRidesList`, `PriceModal`, hooks `useRideReconciliation` / `useScanResults`.
5. **`.env.example` est vide.** Le `CLAUDE.md` demande de le copier en `.env` : le remplir avec les clés placeholder (`PUBLIC_SUPABASE_URL`, `REVENUECAT_*`, `TOMTOM_API_KEY`, etc.) pour l'onboarding dev et éviter les erreurs au build.

---

## 🟢 Points forts (à conserver tel quel)

1. **RLS exhaustive et correcte** (`20260425_rls_policies.sql`). Owner-only (`auth.uid() = user_id`) sur toutes les tables utilisateur, `parser_config`/`vehicles_db` en lecture seule authentifiée, écriture réservée au `service_role`. Requêtes de test d'isolation fournies. **Un chauffeur ne peut pas lire les courses d'un autre.** ✅
2. **`gemini-proxy` durci, exemplaire** : revérification JWT côté code (défense en profondeur), rate-limit 60/h/user **+ circuit breaker budget global 24 h** (protège la facture contre l'abus multi-comptes), **fail-closed** si DB injoignable, plafond body 2 Mo, validation structurelle du payload, CORS whitelisté.
3. **Privacy by design sur l'image** : aucune capture écrite sur disque. OCR via `cgImage` en mémoire, Gemini via base64 en mémoire, l'URL temporaire de la Share Sheet est gérée et purgée par iOS. **Pas de cache RGPD à nettoyer.** ✅
4. **Stockage de session chiffré** (`secureStorage.ts`) : Keychain/Keystore via `react-native-keychain`, `AFTER_FIRST_UNLOCK`, **migration transparente** depuis l'ancien AsyncStorage en clair, fallback gracieux.
5. **Anti-tampering tier** (`20260427`) : trigger `prevent_tier_tampering` + bypass par GUC local `is_local` (invisible au client PostgREST). `subscription_tier`, `extra_scan_credits`, `daily_scans_count` réellement read-only côté client.
6. **Robustesse du pipeline natif** : `CompletionGuard` (single-fire thread-safe) + watchdog 20 s anti-deadlock dans `ScanProcessor`, throttle anti-double-tap cross-process via App Group.
7. **Sync offline solide** (`offlineService.ts`) : mutex `syncInFlight` contre les doublons concurrents, retry plafonné (5×) avec ré-indexation correcte, notification utilisateur sur drop, cap de queue.
8. **Webhook RevenueCat mûr** : idempotence (`processed_webhook_events`), rejet des events `SANDBOX` en prod, validation UUID de `app_user_id`, architecture lookup-table (pas de redéploiement pour changer un pack).

---

## Note sur les « secrets »

Les clés trouvées (`AIza…` dans `google-services.json` / `GoogleService-Info.plist`) sont des **identifiants Firebase client**, destinés à être embarqués — ce ne sont pas des secrets exploitables. Recommandation tout de même : appliquer des **restrictions d'application** (bundle id / SHA) sur ces clés API dans la console Google Cloud. Aucun secret serveur (`service_role`, `GEMINI_API_KEY`, token webhook) n'est présent dans le code — ils sont correctement injectés via `Deno.env` / `secrets set`. `.env` est bien git-ignoré ; aucun `.env` n'est suivi par git.

---

## 🔁 Seconde passe (2026-06-29)

Couverture ajoutée : edge function `fuel-prices`, migrations `security_hardening` / `plan_limits` / `fix_quota_timezone` / `email_anti_abuse`, `iapService` / `subscriptionService`, et **tout le natif Android** (`StriveAccessibilityService`, `ScanBridgeModule`, `GeminiVisionService`, `TomTomService`, `GeocodeCache`, capture MediaProjection).

### Nouvelles découvertes

#### 🟠 N1 — Géocodage : adresses (PII) mises en cache **indéfiniment**, jamais purgées · ✅ CORRIGÉ

`ios/Strive/Scanner/GeocodeCache.swift` (« le cache n'expire pas ») et `android/.../GeocodeCache.kt` (SharedPreferences `MODE_PRIVATE`) persistaient les couples **adresse → coordonnées sans aucun TTL**, et n'étaient **pas vidés au logout ni à la suppression de compte** (`delete_account` ne traite que la DB). Stockage sandboxé (non world-readable) mais lisible via backup/root/jailbreak. Manquement à la minimisation/limitation de conservation RGPD.

**Correctif appliqué :**
- **TTL 90 j** + horodatage `savedAt` ajoutés dans les deux caches : une entrée expirée (ou legacy sans `savedAt`) est purgée au `get()` et re-géocodée une fois.
- **`clear()`** ajouté dans les deux caches, exposé via le bridge (`ScanBridge.clearGeocodeCache` iOS `.m`/Swift + `@ReactMethod` Android) et `ScannerService.clearGeocodeCache()`.
- **Câblé au logout** dans `AuthContext` (`SIGNED_OUT`) → couvre aussi la suppression de compte (qui se termine par `signOut()`). Au passage, **le cache offline des courses** (`clearOfflineCache`, qui contient aussi des adresses) est désormais vidé au même endroit.

#### 🟠 N2 — iOS : le JWT utilisateur Supabase est persisté en clair dans l'App Group

`ScanBridgeModule.setSupabaseUserJwt` écrit l'`access_token` dans `UserDefaults(suiteName:)` (lu par la Share Extension et l'AppIntent). La **session principale est bien en Keychain** (point fort), mais cette copie du bearer token vit en clair dans le conteneur App Group (backup/jailbreak la lit). Token court (~1 h), donc risque modéré, mais c'est le maillon faible vs le reste.
**Reco :** partager le token via un **Keychain access group** commun app↔extension plutôt que `UserDefaults`.

#### 🔵 N3 — Fragilité de replay des migrations : références `cars` non gardées

Au-delà de `rls_policies` (déjà gardé en session 1), `20260425_security_hardening.sql` référence `public.cars` **sans garde** : `create index idx_cars_user on public.cars` (l.233) et `delete from public.cars` dans le corps de `delete_account` (l.387, validé à la création via `check_function_bodies`). Sur une **base neuve sans `cars`** (CI / nouvel environnement), ces migrations **échouent**. Sans impact sur la prod actuelle (déjà appliquée + `delete_account` redéfini en dernier par `20260629`).
**Reco :** soit créer `cars` dans une migration de base, soit guarder ces 2 instructions par `to_regclass` (comme fait pour `rls_policies`).

#### 🔵 N4 — Edge function `fuel-prices` sans authentification

`supabase/functions/fuel-prices/index.ts` n'a aucun contrôle d'auth : si déployée en `--no-verify-jwt`, n'importe qui peut la déclencher (invocations gratuites + martèlement de l'API data.gouv depuis ta fonction). Données idempotentes et inoffensives → risque faible.
**Reco :** exiger un header secret de cron, ou déployer avec `verify_jwt` et l'appeler depuis `pg_cron` avec la clé service.

#### Minor
- **Android (pré-11)** : dans `captureViaMediaProjection`, le bitmap intermédiaire `raw` n'est pas `recycle()` quand un crop de padding a lieu — micro-fuite mémoire (GC s'en charge). `image/virtualDisplay/reader` sont, eux, bien fermés en `finally`.

### Confirmations (re-vérifiées — solides)

- **Quota DB entièrement durci** : `enforce_scan_quota` lit `plan_limits` (source unique), utilise `user_day_start` (TZ user + `day_reset_hour`, régression TZ corrigée par `20260611`) **et `SELECT … FOR UPDATE`** anti-race sur inserts concurrents. Excellent.
- **Cohérence des limites** client↔DB : `free=3`, `plus=15`, `premium=∞` identiques (`subscriptionService.FALLBACK_LIMITS` ↔ table `plan_limits`).
- **Chaîne d'abonnement saine** : `iapService` fait `Purchases.logIn(uid)` / `configure({ appUserID: uid })` → le webhook valide bien le format UUID de `app_user_id` (rejet des anonymous_id).
- **Android — usage minimal de l'AccessibilityService** : `onAccessibilityEvent` **vide** (aucune surveillance d'écran), capture d'écran **à la demande** uniquement. Bon réflexe privacy (à documenter pour la review Google Play).
- **Durcissement SQL complet** : CHECK constraints (bornes fare/distance/durée/tier), trigger anti-tampering, storage policies `avatars` owner-scoped (`(storage.foldername(name))[1] = auth.uid()`), `REVOKE EXECUTE … FROM public` sur les RPC sensibles.
- **Correctifs session 1 revalidés** : `delete_account` (C1) — la définition `20260629` est bien la dernière appliquée et passe le test ; deadlock OCR (C2), RLS `fuel_prices` (W7) et mémoïsation `AuthContext` (W1) en place.

### Tableau de synthèse actualisé

| Sévérité | Ouverts | Corrigés cette campagne |
|----------|---------|--------------------------|
| 🔴 Critique | 0 | C1, C2 |
| 🟠 Avertissement | N2 + W2/W3/W4/W5/W6 | W1, W7, **N1** |
| 🔵 Reco | N3, N4 + reco archi | nettoyage `cars` (rls_policies) |
