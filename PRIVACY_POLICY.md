# Politique de confidentialité — Strive

🇫🇷 Français · [🇬🇧 English](./PRIVACY_POLICY.en.md)

**Dernière mise à jour : 29 mai 2026**

Strive (« l'Application ») est une application mobile destinée aux chauffeurs VTC qui scanne les offres de course affichées dans les applications Uber, Bolt et Heetch afin de calculer la rentabilité des courses en temps réel. La présente politique décrit comment nous traitons vos données.

**Éditeur :** [Ton nom / raison sociale]
**Contact :** [ton-email@domaine.com]
**Hébergement :** Supabase (données utilisateur), Sentry (erreurs), Google Firebase (notifications push)

---

## 1. Données collectées

### 1.1 Données de compte
Lorsque vous créez un compte, nous collectons :
- **Adresse e-mail** (via inscription directe ou OAuth Google/Apple)
- **Identifiant Google/Apple anonyme** (si OAuth)
- **Préférences utilisateur** (seuils €/h, €/km, activation pickup, son verdict)

### 1.2 Données de course
À chaque scan d'une offre VTC, nous enregistrons :
- **Plateforme** (Uber / Bolt / Heetch)
- **Tarif affiché** (net)
- **Distance et durée estimées**
- **Adresses de prise en charge et de destination**
- **Taux horaire et taux kilométrique calculés**
- **Statut de la course** (acceptée, refusée, en attente)
- **Horodatage**

Ces données sont utilisées pour afficher votre historique et calculer vos statistiques. Elles ne sont jamais revendues ni partagées avec des tiers commerciaux.

Les **adresses de prise en charge et de destination** constituent votre carnet de bord professionnel (suivi de votre activité de chauffeur). Par souci de minimisation, ces adresses sont **automatiquement effacées au bout de 12 mois** ; le reste de la course (tarif, distance, durée, statut) est conservé pour vos statistiques. Vous pouvez également supprimer l'intégralité de votre historique à tout moment (voir §5).

### 1.3 Données techniques
- **Identifiant appareil** (pour les notifications push via Firebase)
- **Journaux d'erreurs anonymisés** (via Sentry, pour diagnostic bugs)
- **Abonnement RevenueCat** (statut actif/inactif, pas d'information de paiement)

### 1.4 Ce que nous NE collectons PAS
- Contenu des écrans d'Uber, Bolt, Heetch au-delà des champs extraits par OCR
- Historique de navigation
- Géolocalisation en temps réel (nous n'accédons pas au GPS)
- Contacts, photos, fichiers personnels
- Données bancaires (RevenueCat gère les paiements directement via App Store / Play Store)

---

## 2. Service d'accessibilité Android

Strive utilise le **service d'accessibilité Android** et la **capture d'écran (MediaProjection)** exclusivement pour :
- Permettre à la bulle flottante d'apparaître par-dessus les applications VTC
- Capturer l'écran, **uniquement lorsque vous appuyez sur le bouton de scan**, pour analyser l'offre via OCR (ML Kit de Google, analyse locale sur votre appareil)

**Aucune capture d'écran n'est effectuée sans votre action explicite.** Aucune donnée personnelle n'est lue dans d'autres applications. L'analyse OCR est réalisée localement ; l'image capturée n'est pas envoyée à un serveur tiers sauf dans le cas où l'OCR local échoue totalement — dans ce cas, et uniquement dans ce cas, une image compressée est envoyée à notre fonction Edge Supabase qui l'analyse via Gemini (Google AI) puis la supprime immédiatement.

---

## 3. Sous-traitants et transferts

Vos données peuvent être traitées par les sous-traitants suivants :

| Sous-traitant | Rôle | Hébergement |
|---|---|---|
| **Supabase** | Base de données, authentification, edge functions | UE (Francfort) |
| **Google Firebase** | Notifications push (FCM) | UE / US |
| **Sentry** | Diagnostic d'erreurs anonymisé | UE |
| **RevenueCat** | Gestion des abonnements | US |
| **TomTom** | Géocodage d'adresses, calcul d'itinéraires | UE (Amsterdam) |
| **Google Gemini** | Fallback OCR (uniquement si OCR local échoue) | US |

Les transferts hors UE sont encadrés par les clauses contractuelles types de la Commission européenne ou le Data Privacy Framework.

---

## 4. Durée de conservation

- **Données de compte** : tant que le compte est actif, puis 30 jours après suppression
- **Historique des courses** : conservé tant que le compte est actif. Les **adresses de départ/destination sont automatiquement effacées après 12 mois** ; les autres données de course (tarif, distance, durée, statut) restent disponibles pour vos statistiques. Vous pouvez supprimer tout votre historique à tout moment depuis l'application (voir §5)
- **Journaux d'erreurs Sentry** : 90 jours maximum
- **Données de facturation RevenueCat** : durée légale (10 ans)

---

## 5. Vos droits (RGPD)

Conformément au RGPD, vous disposez des droits suivants :
- **Accès** : obtenir une copie de vos données
- **Rectification** : corriger des données inexactes
- **Effacement** : supprimer votre compte et toutes vos données associées
- **Portabilité** : recevoir vos données dans un format lisible par machine (JSON)
- **Opposition** : vous opposer au traitement à des fins de statistiques

Pour exercer ces droits, contactez-nous à **[ton-email@domaine.com]**. Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr).

### Suppression du compte
Vous pouvez supprimer votre compte directement depuis l'application : **Profil → Paramètres → Supprimer le compte**. La suppression est définitive et irréversible après un délai de grâce de 7 jours.

### Suppression de l'historique de courses
Vous pouvez effacer l'intégralité de votre historique de courses (adresses incluses) sans supprimer votre compte : **Profil → Informations du compte → Supprimer mon historique**. Cette suppression est définitive et immédiate.

---

## 6. Sécurité

- Connexions chiffrées TLS 1.3 vers tous les serveurs
- Authentification via OAuth 2.0 (Google, Apple) ou e-mail + mot de passe haché (bcrypt, via Supabase Auth)
- RLS (Row Level Security) sur Supabase : chaque utilisateur ne peut lire/écrire que ses propres données
- Aucune clé API sensible n'est stockée côté client (appels Gemini routés via edge function)

---

## 7. Cookies et traceurs

L'application mobile n'utilise pas de cookies. Aucun traceur publicitaire n'est intégré.

---

## 8. Enfants

Strive est destiné aux professionnels majeurs (chauffeurs VTC). L'application n'est pas conçue pour les mineurs et ne collecte pas sciemment leurs données.

---

## 9. Modifications

Cette politique peut être mise à jour. La date « Dernière mise à jour » indique la version en vigueur. Les modifications substantielles vous seront notifiées dans l'application.

---

## 10. Contact

**Éditeur :** [Ton nom / raison sociale]
**E-mail :** [ton-email@domaine.com]
**Adresse :** [Ton adresse postale si auto-entrepreneur]
