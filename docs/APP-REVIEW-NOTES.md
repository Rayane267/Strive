# App Review — réponse type et checklist de soumission

> ### À savoir si le Réseau est rallumé un jour
>
> Le **Réseau** (`NetworkOfferScreen` / `NetworkReceiveScreen`) laisserait un
> chauffeur **publier une course** — adresses, prix convenu — visible par
> d'autres chauffeurs. Ce serait du contenu généré par les utilisateurs.
>
> **Il ne part PAS dans l'app** : `RIDE_NETWORK_ENABLED = false`
> (`src/services/networkDemo.ts`) retire à la fois la carte du Dashboard et
> l'enregistrement des deux routes. Il n'y a donc rien à déclarer à Apple
> aujourd'hui, et la réponse ci-dessous n'en parle pas — annoncer une
> fonctionnalité absente du binaire ferait chercher au reviewer un écran
> introuvable.
>
> Le jour où le drapeau repasse à `true`, la **Guideline 1.2** s'applique et
> exige, AVANT la soumission : filtrage du contenu, **signalement**, **blocage**
> d'un utilisateur abusif, et un contact publié. Aucun de ces mécanismes
> n'existe aujourd'hui dans les écrans Réseau. Il faudra aussi trancher la
> question du statut d'intermédiaire de réservation dans les pays couverts —
> juridique, pas App Store.

Ce fichier a deux moitiés :

1. **La réponse à Apple**, en anglais, prête à coller — dans la réponse App Store
   Connect ET dans le champ *App Review Information → Notes*. Apple demande
   explicitement qu'elle y reste « for reference on future submissions » : c'est
   pour ça qu'elle vit ici, versionnée, et pas dans un mail perdu.
2. **La checklist interne**, en français, à repasser AVANT chaque soumission.
   Elle liste ce qui, dans ce dépôt, peut faire échouer une revue — pas des
   généralités, des choses qu'on a vues casser.

---

## 1. Réponse à Apple (à coller telle quelle)

> **1. Screen recording**
>
> A screen recording captured on an iPhone running the latest iOS is attached.
> It starts from app launch and shows: account creation with Sign in with Apple,
> the profile setup, the one-time Shortcut installation, a live ride analysis,
> the subscription screen, and finally account deletion from the Profile tab.
>
> **2. Purpose and target audience**
>
> Strive is a decision tool for private-hire (VTC/ride-hailing) drivers.
>
> When a ride offer appears on a driver's phone, the platform shows a fare and a
> trip estimate. The driver has a few seconds to accept or decline, and the
> displayed estimate does not tell them what the ride is actually worth: it
> ignores the time and distance needed to reach the passenger, and it is
> computed without live traffic.
>
> Strive answers one question: **is this ride worth taking?** The driver
> triggers Strive from the offer screen. Strive reads the fare, the pickup
> address and the destination from that screen, computes the real route with
> live traffic, adds the approach leg, and returns an hourly rate and a rate per
> kilometre, compared against thresholds the driver has set. The result is shown
> as a colour verdict on a Live Activity so it can be read at a glance.
>
> Accepted rides are stored, so the driver also gets their real earnings,
> working time and statistics over the week — numbers no single platform can
> give them, because most drivers work on several.

>
> Target audience: professional private-hire drivers in France, Belgium,
> Switzerland, Spain, Portugal and the United Kingdom. The app is not aimed at
> passengers and has no passenger-facing features.
>
> **3. Setting up and accessing the main features**
>
> **There is no demo username and password, because the app has no password
> login.** Authentication is Sign in with Apple or Google Sign-In only. You can
> create an account in a few seconds with your own Apple ID — Sign in with
> Apple is the flow shown in the screen recording — and delete it from the
> Profile tab when you are done. Deletion is immediate and removes the account
> and its data.
>
> Strive Plus
> is unlocked from the Subscription tab with a sandbox purchase — the
> subscription flow is part of what we would like you to test. On the free tier
> the app allows three ride analyses per day, which is by design; Strive Plus
> removes that limit.
>
> 1. Launch the app and sign in with the demo credentials (or with Sign in with
>    Apple — account creation is open).
> 2. Complete the short profile step (first name, last name).
> 3. A guided tutorial installs the Shortcut used to trigger an analysis. This
>    step matters: **the analysis is triggered from outside the app**, from the
>    ride offer screen, because that is where the driver is when the decision
>    has to be made. The tutorial installs it in a few taps and can be replayed
>    from Profile → Help.
> 4. On the Dashboard, turn the session on ("Go online").
> 5. Open the sample ride-offer screenshot supplied with this submission (or any
>    ride offer screen), then trigger the Shortcut. Strive analyses what is on
>    screen and returns the verdict on a Live Activity.
> 6. The Dashboard, History and Analytics tabs then show the recorded rides.
> 7. Account deletion: Profile → Delete my account. It is immediate and
>    irreversible, and it removes the account and its rides.
>
> A test screenshot is attached so the feature can be exercised without waiting
> for a real ride offer.
>
> **4. External services used**
>
> | Service | Role |
> |---|---|
> | Supabase | Authentication, database, and serverless functions |
> | Sign in with Apple / Google Sign-In | Authentication providers |
> | RevenueCat | Subscription management on top of Apple In-App Purchase |
> | TomTom | Geocoding and routing with live traffic |
> | Firebase Cloud Messaging | Push notifications |
> | Sentry | Crash and error reporting |
> | data.economie.gouv.fr | French government open data, used for fuel prices |
>
> Text recognition runs on the device (Apple Vision). A screenshot only leaves
> the device when on-device recognition fails, and it is not retained.
>
> **5. Regional differences**
>
> The app behaves the same in every supported region. Supported markets are
> France, Belgium, Switzerland, Spain, Portugal and the United Kingdom, with
> three currencies (EUR, CHF, GBP) and seven interface languages (French,
> English, Spanish, Portuguese, Dutch, German, Italian). Distances are shown in
> miles in the United Kingdom and in kilometres elsewhere.
>
> One feature is region-dependent, and it is an optional display: the fuel cost
> estimate uses French government open data on fuel prices. Outside France the
> driver can enter their own fuel price manually. Every other feature —
> analysis, verdict, history, statistics, subscriptions — is identical in all
> regions.
>
> **6. Regulated industry and third-party material**
>
> Strive is not a transport provider. It does not dispatch or assign rides, does
> not process passenger payments, is not a party to any ride, and does not
> connect to any ride-hailing platform's API or driver account. It has no
> business relationship with those platforms and does not need one.
>
> What the app processes is a screenshot the driver takes on their own device,
> of information already displayed to them, about a ride they have been offered.
> The analysis runs on the driver's device and on our own server function. The
> app uses no ride-hailing platform's logo, trademark or branding: platform
> names appear only as plain text labels, to tell the driver which platform a
> recorded ride came from.
>
> The app has **no user-generated content**: nothing a driver enters is shared
> with, or visible to, any other user. Each account only ever sees its own
> rides and its own statistics. There is therefore no content feed to moderate,
> and no reporting or blocking mechanism is required.
>
> No licence or authorisation from a third party is required to provide this
> functionality.

---

## 1 bis. Rejet du 21 septembre 2026 — build 143 (à coller dans la réponse ASC)

Deux motifs : **2.1(b)** (produits d'achat intégré non soumis) et **Guideline 5**
(CallKit + Chine). Aucun des deux ne vient du code applicatif ; les deux se
règlent dans App Store Connect, plus un nouveau binaire qu'Apple exige.

Sur CallKit : l'app ne passe **aucun appel**. Le seul symbole CallKit du binaire
est `CXCallObserver`, en lecture seule, dans
`ios/Strive/AppIntents/AnalyzeRideIntent.swift` — il sert à savoir si un appel
occupe déjà l'Îlot dynamique, auquel cas le verdict part *aussi* en notification
locale (sinon le chauffeur ne voit qu'une pastille de couleur). Pas de
`CXProvider`, pas de PushKit, pas de mode d'arrière-plan `voip`, pas
d'entitlement CallKit, aucune dépendance de téléphonie. C'est le scan statique
d'Apple qui voit l'`import CallKit`, pas une fonctionnalité d'appel.

Le correctif retenu est de **retirer la Chine continentale des territoires**
(App Store Connect → Pricing and Availability → Availability). Strive se vend en
France, Belgique, Suisse, Espagne, Portugal et Royaume-Uni : la Chine n'apporte
rien et la condition posée par Apple (« CallKit *et* Chine disponible ») tombe.
L'alternative — retirer `CXCallObserver` du binaire — coûterait la notification
de secours pendant un appel, sans contrepartie.

> **Guideline 2.1(b) — In-App Purchase products**
>
> Every In-App Purchase product offered by this version is now submitted for
> review together with this build: two auto-renewable subscriptions
> (`strive_plus_monthly`, `strive_plus_yearly`), in the "Strive" subscription
> group. Each one has its
> localisations, its price and its App Review screenshot, and each one is
> attached to this version of the app.
>
> They are offered on the Subscription tab, reachable from the tab bar once
> signed in, and can be purchased in the sandbox with no prior setup. **The app
> offers no other in-app purchase in this version.**
>
> **Guideline 5 — CallKit in China**
>
> Strive has no calling functionality of any kind. It is not a VoIP app: it does
> not place, receive, answer or display calls, it links no telephony SDK, it
> declares no `voip` background mode and no CallKit entitlement, and it never
> uses `CXProvider`, `CXCallController` or PushKit.
>
> The only CallKit symbol in the binary is `CXCallObserver`, used read-only in a
> single place, to know whether a call is currently occupying the Dynamic
> Island. When one is, the app additionally delivers a local notification so the
> driver can still read the result of a ride analysis, which would otherwise be
> reduced to a coloured dot. No call is ever created, modified or presented by
> the app, and no call state is stored or transmitted.
>
> To remove any ambiguity, we have also removed China mainland from the app's
> territories in App Store Connect. Strive is now available in France, Belgium,
> Switzerland, Spain, Portugal and the United Kingdom only.

---

## 2. Checklist interne — à repasser avant CHAQUE soumission

### Ce qui fait rejeter, et qu'on a déjà vu casser

- [ ] **`delete_account` fonctionne sur la base de PRODUCTION.**
      C'est le premier test du reviewer, et la suppression de compte est une
      exigence pour toute app qui permet d'en créer un. Le registre de scans par
      appareil a cassé cette fonction une fois : `device_scan_ledger.user_id`
      était dans la clé primaire, donc `on delete set null` violait un
      `not null` et **le DELETE entier échouait**. Le correctif est
      `20260917_device_scan_ledger_fix_pk.sql`.
      Vérification, sur un compte jetable, en prod :
      `select public.delete_account();` → aucune erreur.

- [ ] **Toutes les migrations sont appliquées en production.** Une migration qui
      dort dans le dépôt pendant que le binaire part est la façon la plus simple
      de livrer une app qui marche en local et casse en revue.

- [ ] **Les SKU `strive_premium_*` sont DÉTACHÉS de cette version** dans App
      Store Connect. Premium est en suspens (`PREMIUM_ENABLED = false`) : le
      paywall ne le vend plus, et un abonnement soumis que le reviewer ne peut
      pas atteindre fait rejeter le build. Ne pas les supprimer — un ID supprimé
      n'est pas réutilisable.

- [ ] **Plus est à 8,99 €/mois et 79,99 €/an dans App Store Connect.** Les
      montants du code (`FALLBACK_AMOUNT`) ne servent que si le store ne répond
      pas ; le prix facturé est celui du store.

- [ ] **Le reviewer peut atteindre Plus.** Choix retenu : il l'achète en
      sandbox depuis l'écran Abonnement. À vérifier avant chaque soumission — si
      l'achat échoue, il reste bloqué au palier
      gratuit, soit 3 scans par jour. Repli possible sans toucher au palier :
      `welcome_credits` n'est pas protégé par `protect_tier_fields` et passe outre
      le quota journalier comme le plafond d'appareil.

- [ ] **`REVENUECAT_ALLOW_SANDBOX=true` est TOUJOURS actif.** Le reviewer teste
      les achats en sandbox : le retirer avant la publication fait rejeter l'app.
      Il se retire APRÈS.

- [ ] **Les produits d'achat intégré sont soumis AVEC le build**, pas après.
      C'est le motif du rejet du 21/09/2026 (2.1(b)) : les 8 produits existaient
      dans App Store Connect mais aucun n'était **rattaché à la version**, donc
      aucun n'est parti en revue. Créer un produit ne le soumet pas.
      **Seuls les 4 abonnements partent.** Les 4 consommables
      (`strive_scan_pack_*`) ne sont vendus que par `ShopScreen`, qui n'est
      branché sur aucun navigateur : le reviewer ne peut pas les atteindre, et
      un produit introuvable se fait rejeter. Ils restent donc en
      « Missing Metadata » dans ASC, non rattachés à la version — **sans les
      supprimer** : Apple interdit de réutiliser l'ID d'un produit supprimé, et
      ces IDs sont câblés dans `iapService.ts`, dans `subscription_products` et
      dans le webhook RevenueCat.
      Dans l'ordre, pour chacun des 4 abonnements de `src/services/iapService.ts` :
      1. métadonnées complètes (prix, au moins une localisation, et pour les
         abonnements l'appartenance au groupe « Strive ») ;
      2. **capture d'écran App Review** — obligatoire, 640 × 920 px minimum, une
         par produit ; la même capture de l'écran Abonnement / Boutique fait
         l'affaire pour tous. Sans elle le produit reste bloqué en
         « Missing Metadata » et ne peut pas être soumis ;
      3. état « Ready to Submit », puis la version de l'app →
         **In-App Purchases and Subscriptions** → ajouter les 4 abonnements.
      Vérifier avant d'envoyer : chaque produit doit afficher
      « Waiting for Review », pas « Ready to Submit ».

- [ ] **L'appareil du reviewer n'est pas bloqué à l'inscription.** Le plafond est
      de 5 identités par appareil sur 60 jours glissants, et l'appareil d'Apple a
      pu servir lors d'une soumission précédente. Le refus tombe désormais sur
      l'écran de saisie du prénom, avec un message clair — mais un reviewer
      bloqué là, c'est un rejet sans appel. En cas de doute, purger les lignes de
      `device_signups` correspondantes avant la soumission.

- [ ] **Territoires : la Chine continentale reste décochée.** Le binaire
      contient `import CallKit` (`CXCallObserver`, lecture seule, dans
      `AnalyzeRideIntent.swift`), et le MIIT interdit CallKit sur l'App Store
      chinois : CallKit + Chine disponible = rejet automatique, quel que soit
      l'usage réel. Rouvrir la Chine imposerait de retirer `CXCallObserver`
      d'abord. Idem si un jour une dépendance tire CallKit ou PushKit —
      `grep -rn "CallKit\|PushKit" ios/` doit ne remonter que ce fichier.

### Fonctionnalités en sommeil

- [ ] **La Boutique (`ShopScreen`) n'est toujours atteignable par aucune route.**
      Rien ne l'importe : les 4 packs de scans ne sont donc pas vendus dans le
      binaire, et il ne faut PAS soumettre leurs SKU (cf. plus haut). Le jour où
      l'écran est branché, l'ordre est : brancher la route, builder, PUIS
      soumettre les 4 consommables avec ce build — et pas l'inverse.

- [ ] **`RIDE_NETWORK_ENABLED` est toujours à `false`.** S'il passe à `true`,
      l'app diffuse du contenu d'un chauffeur à d'autres : la Guideline 1.2
      s'applique, et signalement + blocage doivent exister AVANT la soumission.
      Voir le bandeau en tête de ce fichier.

### Ce que le reviewer ne trouvera JAMAIS tout seul

- [ ] **L'analyse se déclenche depuis un raccourci iOS, pas depuis un bouton de
      l'app.** C'est le cœur du produit et c'est hors de l'app. Sans instructions
      explicites, le reviewer ouvre l'app, ne voit qu'un tableau de bord vide, et
      conclut que l'app ne fait rien. Le tutoriel d'installation doit apparaître
      dans l'enregistrement, et les étapes doivent être écrites dans les notes.

- [ ] **Fournir une capture d'écran d'offre de test** avec la soumission. Sans
      elle, le reviewer devrait attendre une vraie offre VTC : il ne le fera pas.

- [ ] **La session doit être « en ligne »** pour qu'un scan parte. Un scan
      déclenché session fermée est refusé volontairement (`session_off`).

### Tests sur appareil physique (Apple insiste, et c'est justifié)

- [ ] Création de compte → profil → tutoriel → scan → verdict, sur un iPhone réel
- [ ] Suppression de compte, puis recréation avec la même identité
- [ ] Achat d'abonnement en sandbox, puis restauration
- [ ] L'app en arrière-plan pendant un scan (c'est le cas normal)
- [ ] Notifications refusées : rien ne doit disparaître en silence

### Captures d'écran App Store

- [ ] Elles montrent l'app EN USAGE — pas l'écran de connexion, pas le logo,
      pas d'écran d'accroche (Guideline 2.3.3).
