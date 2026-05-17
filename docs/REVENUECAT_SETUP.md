# Setup RevenueCat — Strive

Checklist pour brancher RevenueCat à Strive end-to-end. À faire **une fois** que tu auras un compte Apple Developer + Google Play Developer.

> **Avant ça** : tu peux déjà déployer la migration DB (`20260426_subscription_schema.sql`) et l'edge function (`revenuecat-webhook`). Le webhook sera juste inactif tant que tu ne configures pas le dashboard RevenueCat.

---

## 0. Prérequis

- [ ] Compte Apple Developer (99$/an) — https://developer.apple.com
- [ ] Compte Google Play Developer (25$ une fois) — https://play.google.com/console
- [ ] Compte RevenueCat (free jusqu'à 2.5k$ MTR) — https://app.revenuecat.com

---

## 1. SKU à créer (mêmes IDs côté Apple, Google et RevenueCat)

Convention : noms **abstraits**, pas de prix dans le SKU. Cf. `subscription_products` table en DB.

### Subscriptions (auto-renewable)

| Product ID                 | Tier      | Période  |
| -------------------------- | --------- | -------- |
| `strive_plus_monthly`      | plus      | 1 mois   |
| `strive_plus_yearly`       | plus      | 1 an     |
| `strive_premium_monthly`   | premium   | 1 mois   |
| `strive_premium_yearly`    | premium   | 1 an     |

### Consumables (packs de scans)

| Product ID              | Crédits |
| ----------------------- | ------- |
| `strive_scan_pack_xs`   | 1       |
| `strive_scan_pack_s`    | 3       |
| `strive_scan_pack_m`    | 5       |
| `strive_scan_pack_l`    | 10      |

> Tu peux ne créer qu'un sous-ensemble en v1 (par ex. juste `strive_plus_monthly` + `strive_scan_pack_s`) et ajouter le reste plus tard. La table `subscription_products` est déjà seedée avec les 8 SKU mais ils sont inertes tant qu'aucun event n'arrive.

---

## 2. App Store Connect

1. Mon App → **Fonctionnalités** → **Achats intégrés** → **+**
2. Pour chaque SKU :
   - **Type** : `Abonnement à renouvellement automatique` (subs) ou `Consommable` (packs)
   - **ID de référence** : le SKU exact (ex. `strive_plus_monthly`)
   - **Nom de référence** : interne, ex. "Strive Plus mensuel"
   - **Prix** : selon ta grille (ex. 9,99 € pour Plus mensuel)
   - **Localisations** : au moins fr-FR + en-US (titre + description affichés à l'achat)
3. Subs uniquement : crée un **Groupe d'abonnements** "Strive" et range tous les abonnements dedans (sinon le user peut souscrire à plusieurs en parallèle).
4. **Soumets** chaque produit pour review (peut être fait en même temps que l'app).

---

## 3. Google Play Console

1. App → **Monétiser avec Play** → **Produits**
2. **Abonnements** : un produit par tier (`strive_plus_monthly`, etc.) avec un seul `base plan` chacun.
3. **Produits intégrés** (non-récurrents) : un produit par pack de scans, type "Consommable géré".
4. Active la facturation Google Play (service account + lien à RevenueCat — cf. doc RC).

---

## 4. RevenueCat Dashboard

### a. Project settings
- Crée un projet "Strive"
- Apps :
  - **iOS** : bundle id `com.strive.app` (ou ce que tu utilises) + clé API App Store Connect
  - **Android** : package name `com.strive.app` + service account JSON Google Play

### b. Products
- Importe les SKU depuis App Store + Play Console (RevenueCat sync auto si tu as bien lié les comptes)

### c. Entitlements
- Crée 2 entitlements : `plus` et `premium`
- Attache les SKU :
  - `plus` ← `strive_plus_monthly`, `strive_plus_yearly`
  - `premium` ← `strive_premium_monthly`, `strive_premium_yearly`
- Les consumables (packs scans) **n'ont pas d'entitlement** — ils sont gérés via le webhook qui crédite `extra_scan_credits`.

### d. Offerings
- Crée une offering `default` qui contient :
  - Package `monthly` → `strive_plus_monthly`
  - Package `annual` → `strive_plus_yearly`
  - Package `premium_monthly` → `strive_premium_monthly`
  - etc.
- L'app appelle `Purchases.getOfferings()` et lit `offerings.current`.

### e. Webhook → Supabase
1. Génère un token aléatoire fort (ex. `openssl rand -hex 32`)
2. Configure le secret côté Supabase :
   ```bash
   supabase secrets set REVENUECAT_WEBHOOK_AUTH=<token>
   ```
3. Déploie l'edge function :
   ```bash
   supabase functions deploy revenuecat-webhook --no-verify-jwt
   ```
   > `--no-verify-jwt` car RevenueCat n'envoie pas de JWT Supabase. L'auth se fait via le header `Authorization: Bearer <token>` qu'on vérifie nous-mêmes.
4. Dans RevenueCat → **Integrations** → **Webhooks** → **Add new** :
   - URL : `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`
   - Authorization header value : `Bearer <token>`
   - Active tous les events sauf `TEST` si tu veux du bruit minimal
5. Clique **Send test event** → vérifie que tu reçois `200 OK` côté RC et que `audit_log` contient une nouvelle ligne `revenuecat_event`.

---

## 5. Côté app (à faire dans une release future)

> Pas dans le scope actuel — fiche pour mémoire.

```ts
// Dans AuthContext, après login Supabase réussi :
import Purchases from 'react-native-purchases';

await Purchases.logIn(session.user.id); // synchronise app_user_id avec auth.uid
```

Pour acheter :
```ts
const offerings = await Purchases.getOfferings();
const pkg = offerings.current?.monthly; // ou .annual, .availablePackages, etc.
if (pkg) {
  await Purchases.purchasePackage(pkg);
  // → webhook RC fire → Supabase RPC apply_revenuecat_event → profile mis à jour
  // → l'app re-fetch le profile via AuthContext
}
```

Pour vérifier si premium :
```ts
const info = await Purchases.getCustomerInfo();
const isPremium = info.entitlements.active['premium'] !== undefined;
```

> Source de vérité = `profiles.subscription_tier` côté Supabase (mise à jour par le webhook). RevenueCat sert uniquement au flow d'achat et au sync stores.

---

## 6. Tests à faire avant prod

- [ ] Webhook reçoit `INITIAL_PURCHASE` → `profiles.subscription_tier` passe à `plus`/`premium`
- [ ] Webhook reçoit `EXPIRATION` → tier retombe à `free`
- [ ] Webhook reçoit `NON_RENEWING_PURCHASE` (pack scans) → `extra_scan_credits` augmente
- [ ] Achat sandbox iOS depuis l'app crée bien une row `audit_log` avec `action = 'revenuecat_event'`
- [ ] Achat avec mauvais token Bearer → 401
- [ ] Achat avec `app_user_id` non-UUID (anonymous) → 200 + log "ignored: anonymous_user"

---

## 7. Quand tu veux changer un pack plus tard

**Tu n'as PAS besoin de redéployer l'app ni l'edge function** :

```sql
-- Passer le pack S de 3 → 5 scans
update subscription_products set scan_credits = 5 where product_id = 'strive_scan_pack_s';

-- Désactiver un SKU obsolète (sans le supprimer, pour préserver l'historique)
update subscription_products set is_active = false where product_id = 'strive_scan_pack_xs';

-- Ajouter un nouveau pack géant
insert into subscription_products (product_id, product_type, scan_credits, notes)
  values ('strive_scan_pack_xl', 'consumable', 25, 'Pack 25 scans');
-- Puis crée le SKU côté App Store / Play Console / RevenueCat avec le même ID.
```

**Tu DOIS modifier le code uniquement si** :
- Tu changes les limites du tier free dans `subscriptionService.PLAN_LIMITS` (et le trigger `enforce_scan_quota` en SQL)
- Tu ajoutes un nouveau tier (ex. `enterprise`) → CHECK constraint + RPC + UI
