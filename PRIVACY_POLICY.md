# Politique de Confidentialité — Strive

🇫🇷 Français · [🇬🇧 English](./PRIVACY_POLICY.en.md)

**Dernière mise à jour : 13 juin 2026**

---

## Préambule

La présente Politique de Confidentialité décrit la manière dont l'éditeur de l'application mobile **Strive** (l'« **Éditeur** », « **nous** ») collecte, utilise, partage et protège les données à caractère personnel des utilisateurs (l'« **Utilisateur** », « **vous** »), conformément au Règlement (UE) 2016/679 (« **RGPD** ») et à la loi n° 78-17 du 6 janvier 1978 modifiée (« Informatique et Libertés »).

Strive est un outil d'aide à la décision pour chauffeurs VTC indépendants : à la demande de l'Utilisateur, l'Application lit une proposition de course affichée à l'écran afin d'en estimer la rentabilité. La protection de votre vie privée est au cœur de la conception du Service (*privacy by design*).

## 1. Responsable du traitement

Le responsable du traitement est :

> **[À COMPLÉTER : raison sociale ou nom, forme juridique, SIREN, siège social]**

**Contact (et exercice des droits) :** supportstriveapp@gmail.com

> **[À COMPLÉTER, le cas échéant : coordonnées du Délégué à la Protection des Données (DPO)]**

## 2. Données que nous traitons

Nous appliquons le principe de **minimisation** : nous ne traitons que les données nécessaires au fonctionnement du Service.

**2.1 — Données de compte**
- Adresse e-mail, identifiant de compte ;
- Méthode de connexion (e-mail, Google, Apple).

**2.2 — Données de profil et de véhicule**
- Marque, modèle, année, type de carburant et consommation moyenne du véhicule ;
- Langue et fuseau horaire de l'appareil ;
- Préférences : seuils minimum €/h et €/km, heure de réinitialisation de la journée, options d'affichage.

**2.3 — Données relatives aux courses scannées**
- Plateforme, tarif proposé, distance, durée, statut (acceptée / refusée), horodatage ;
- Adresses de prise en charge et de destination de la course, lorsqu'elles figurent dans l'offre, utilisées pour calculer la distance et la durée réelles et alimenter votre historique et vos statistiques ;
- Sessions de conduite (début, fin, durée).

**2.4 — Données d'abonnement**
- Statut et type d'abonnement, crédits de Scans, identifiant technique transmis par notre prestataire de gestion d'abonnement. **Nous n'avons accès à aucune donnée bancaire** : les paiements sont gérés par l'App Store ou Google Play.

**2.5 — Données techniques et notifications**
- Jeton de notification push (rappels de session, recharge de quota) ;
- Journaux techniques d'actions sensibles et rapports d'erreurs / de plantages aux fins de sécurité et de stabilité.

**2.6 — Mesure de qualité et diagnostic**
- **Télémétrie non nominative** : pour chaque Scan, des indicateurs agrégeables (plateforme, nombre d'adresses détectées, tranche de prix, verdict, recours ou non au traitement cloud de secours). **Cette télémétrie ne contient ni montant exact, ni adresse, ni coordonnée.**
- **Capture de diagnostic (phase bêta, sur consentement)** : lorsque l'analyse locale ne parvient pas à lire une adresse, l'Application peut enregistrer les blocs de texte issus de l'OCR de l'écran scanné (lesquels peuvent contenir des adresses) afin d'améliorer la fiabilité de l'outil. Ces captures sont **privées, accessibles à vous seul, conservées trente (30) jours au maximum**, et réservées à la phase de test.

## 3. La technologie OCR : fonctionnement et garanties

**3.1 — Une lecture volontaire et ponctuelle.** L'OCR n'est déclenché que par une **action délibérée de l'Utilisateur** (le Scan). L'Application ne lit pas l'écran en continu et ne surveille pas votre activité en arrière-plan. La lecture vise uniquement à extraire les **métriques de la course** (prix, temps, distance, adresses de l'offre).

**3.2 — Un traitement principalement local.** L'analyse OCR s'effectue **directement sur votre appareil** (technologies ML Kit sous Android et Vision sous iOS). **Aucune capture d'écran n'est conservée.**

**3.3 — Traitement cloud de secours.** Lorsque la lecture locale échoue sur une image complexe, l'image de l'offre peut être transmise de manière sécurisée, **le temps de l'analyse uniquement**, à notre prestataire d'analyse d'image (API Google Gemini), afin d'en extraire les informations utiles.

**3.4 — Non-exploitation des données des passagers.** Les éventuelles **données personnelles de tiers** (par exemple le prénom ou l'adresse exacte d'un passager) susceptibles d'apparaître à l'écran **ne sont ni exploitées à des fins commerciales, ni revendues, ni utilisées à d'autres fins que le calcul de rentabilité demandé par l'Utilisateur**. Elles ne sont jamais incluses dans la télémétrie non nominative.

## 4. Finalités et bases légales

| Finalité | Base légale (RGPD) |
|---|---|
| Fournir le Service (scan, verdict, historique, statistiques, abonnement) | Exécution du contrat (art. 6.1.b) |
| Améliorer la fiabilité de l'OCR, prévenir la fraude et les abus, garantir la sécurité | Intérêt légitime (art. 6.1.f) |
| Notifications push et capture de diagnostic (bêta) | Consentement (art. 6.1.a), révocable à tout moment |
| Respect de nos obligations légales (comptables, demandes légitimes) | Obligation légale (art. 6.1.c) |

## 5. Destinataires et sous-traitants

Nous **ne vendons aucune donnée** et n'affichons **aucune publicité**. Nous recourons à des prestataires techniques (sous-traitants au sens de l'art. 28 RGPD), strictement nécessaires au Service :

- **Supabase** — hébergement, base de données et authentification ;
- **Google (API Gemini)** — traitement d'image cloud de secours ;
- **Google (Firebase, Google Sign-In, Play)** — notifications, connexion, distribution ;
- **TomTom** — géolocalisation, géocodage et calcul d'itinéraire (les adresses textuelles peuvent y être transmises pour le calcul de distance/durée) ;
- **RevenueCat** — gestion technique des abonnements (via les stores) ;
- **Apple** — connexion et distribution App Store ;
- **Sentry** — supervision des erreurs et des plantages.

Chacun de ces prestataires est lié par un engagement de confidentialité et de conformité.

## 6. Transferts hors Union européenne

> **[À COMPLÉTER : localisation d'hébergement des données (région Supabase)]**

Certains prestataires (notamment Google et Sentry) peuvent traiter des données en dehors de l'Union européenne. Ces transferts sont encadrés par des garanties appropriées au sens des articles 44 et suivants du RGPD, notamment les **clauses contractuelles types** de la Commission européenne ou un mécanisme équivalent.

## 7. Durées de conservation

- **Compte, profil, courses, sessions** : conservés tant que votre compte est actif ; supprimés lors de la suppression du compte ;
- **Captures de diagnostic (bêta)** : trente (30) jours maximum ;
- **Télémétrie non nominative** : conservée sous forme agrégée à des fins de suivi qualité ;
- **Rapports d'erreurs (Sentry)** : selon la durée de rétention du service (généralement quatre-vingt-dix (90) jours).

## 8. Vos droits

Conformément au RGPD, vous disposez des droits suivants :

- **Droit d'accès** (art. 15) : obtenir la confirmation que des données vous concernant sont traitées et en obtenir copie ;
- **Droit de rectification** (art. 16) : corriger des données inexactes ;
- **Droit à l'effacement** (art. 17) : supprimer vos données ;
- **Droit à la portabilité** (art. 20) : recevoir vos données dans un format structuré, couramment utilisé et lisible par machine, et les transmettre à un autre responsable ;
- **Droit d'opposition et de limitation** (art. 18 et 21) ;
- **Droit de retirer votre consentement** à tout moment, sans remettre en cause la licéité des traitements antérieurs ;
- **Directives relatives au sort de vos données après votre décès.**

**Exercice de vos droits :**
- Vous pouvez consulter et modifier vos données directement depuis l'Application ;
- Vous pouvez **supprimer votre compte et l'intégralité de vos données en une seule action** depuis *Profil → Compte* (cette opération efface vos courses, sessions, véhicules, préférences, votre profil, votre photo et votre compte) ;
- Vous pouvez nous écrire à **supportstriveapp@gmail.com**.

Vous disposez enfin du droit d'introduire une réclamation auprès de la **Commission Nationale de l'Informatique et des Libertés (CNIL)** — <https://www.cnil.fr>.

## 9. Sécurité

Nous mettons en œuvre des mesures techniques et organisationnelles appropriées : chiffrement des échanges en transit (HTTPS), **cloisonnement des données par utilisateur** (chaque chauffeur n'accède qu'à ses propres données), stockage des jetons d'authentification dans le coffre sécurisé du système d'exploitation (Keychain / Keystore), et contrôle des opérations sensibles côté serveur.

## 10. Cookies (site web)

Le site web de présentation de Strive n'utilise pas de cookies publicitaires ni de traceurs tiers à des fins de profilage. **[À COMPLÉTER si des outils de mesure d'audience sont ajoutés.]**

## 11. Mineurs

Le Service s'adresse à des chauffeurs VTC professionnels et **n'est pas destiné aux personnes de moins de 18 ans**. Nous ne collectons pas sciemment de données relatives à des mineurs.

## 12. Modifications

La présente Politique peut être mise à jour. En cas de modification substantielle, vous en serez informé dans l'Application ou par courriel. La date de dernière mise à jour figure en tête du présent document.

## 13. Contact

Pour toute question relative à la protection de vos données : **supportstriveapp@gmail.com**.
