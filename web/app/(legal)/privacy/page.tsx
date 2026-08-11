import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Politique de Confidentialité — Strive',
  description:
    "Données collectées par l'application Strive, base légale RGPD, sous-traitants, durées de conservation et droits des chauffeurs VTC utilisateurs.",
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Politique de Confidentialité</h1>
      <p className="!text-faint text-sm">Dernière mise à jour : 13 juin 2026</p>

      <p>
        La présente Politique décrit comment l&apos;éditeur de l&apos;application Strive
        (l&apos;« Éditeur », « nous ») collecte, utilise, partage et protège vos données à caractère
        personnel, conformément au Règlement (UE) 2016/679 (« RGPD ») et à la loi
        « Informatique et Libertés ». Strive est un outil d&apos;aide à la décision pour chauffeurs
        VTC : à votre demande, l&apos;Application lit une offre de course affichée à l&apos;écran afin
        d&apos;en estimer la rentabilité.
      </p>

      <div className="!my-7 rounded-2xl border border-signal/30 bg-signal/[0.06] p-5 text-sm leading-relaxed text-fg">
        🔒 <strong>Nos engagements fondamentaux.</strong> Strive est <strong>totalement indépendant
        et n&apos;a aucun lien avec Uber, Bolt, Heetch</strong> ou toute autre plateforme VTC. Nous
        <strong> n&apos;exploitons, ne revendons et ne cédons aucune de vos données</strong>, ni
        celles des passagers susceptibles d&apos;apparaître à l&apos;écran. <strong>Aucune publicité,
        aucun traçage publicitaire, aucun courtage de données.</strong> Vos données servent uniquement
        à vous fournir le Service que vous demandez.
      </div>

      <h2>1. Responsable du traitement</h2>
      <p>
        Le responsable du traitement est l&apos;éditeur de Strive :{' '}
        <strong>Rayane TALEB</strong>, entrepreneur individuel (auto-entrepreneur),
        SIREN 988 905 394, siège social : 5 allée de la Caravelle, 94430 Chennevières-sur-Marne, France.
        Pour toute question ou pour exercer vos droits :{' '}
        <a href="mailto:contact@striveapp.fr">contact@striveapp.fr</a>.
      </p>

      <h2>2. Données que nous traitons</h2>
      <p>Nous appliquons le principe de minimisation : seules les données nécessaires au Service sont traitées.</p>
      <h3>Compte</h3>
      <ul>
        <li>Adresse e-mail, identifiant de compte ;</li>
        <li>Méthode de connexion (e-mail, Google, Apple).</li>
      </ul>
      <h3>Profil &amp; véhicule</h3>
      <ul>
        <li>Marque, modèle, année, carburant et consommation moyenne du véhicule ;</li>
        <li>Langue et fuseau horaire de l&apos;appareil ;</li>
        <li>Préférences : seuils minimum €/h et €/km, heure de réinitialisation de journée, options d&apos;affichage.</li>
      </ul>
      <h3>Courses scannées</h3>
      <ul>
        <li>Plateforme, tarif, distance, durée, statut (acceptée / refusée), horodatage ;</li>
        <li>Adresses de prise en charge et de destination présentes dans l&apos;offre, pour calculer la distance/durée réelles et alimenter votre historique ;</li>
        <li>Sessions de conduite (début, fin, durée).</li>
      </ul>
      <h3>Abonnement</h3>
      <ul>
        <li>Statut et type d&apos;abonnement, crédits de Scans, identifiant technique du prestataire de gestion d&apos;abonnement. <strong>Nous n&apos;avons accès à aucune donnée bancaire</strong> : les paiements sont gérés par l&apos;App Store ou Google Play.</li>
      </ul>
      <h3>Données techniques &amp; notifications</h3>
      <ul>
        <li>Jeton de notification push ;</li>
        <li>Journaux techniques d&apos;actions sensibles et rapports d&apos;erreurs / plantages (sécurité, stabilité).</li>
      </ul>
      <h3>Mesure de qualité &amp; diagnostic</h3>
      <ul>
        <li><strong>Télémétrie non nominative</strong> : par Scan, des indicateurs agrégeables (plateforme, nombre d&apos;adresses détectées, tranche de prix, verdict, recours ou non au traitement cloud). <strong>Jamais le montant exact, ni les adresses, ni de coordonnées.</strong></li>
        <li><strong>Capture de diagnostic (bêta, sur consentement)</strong> : si l&apos;analyse locale ne lit pas une adresse, l&apos;Application peut enregistrer les blocs de texte OCR de l&apos;écran (pouvant contenir des adresses) pour fiabiliser l&apos;outil. <strong>Privées, visibles de vous seul, conservées 30 jours maximum</strong>, réservées à la phase de test.</li>
      </ul>

      <h2>3. La technologie OCR : fonctionnement et garanties</h2>
      <ul>
        <li><strong>Lecture volontaire et ponctuelle</strong> : l&apos;OCR n&apos;est déclenché que par une action délibérée (le Scan). L&apos;Application ne lit pas l&apos;écran en continu et ne surveille pas votre activité en arrière-plan.</li>
        <li><strong>Traitement principalement local</strong> : l&apos;analyse se fait sur votre appareil (ML Kit sous Android, Vision sous iOS). <strong>Aucune capture d&apos;écran n&apos;est conservée.</strong></li>
        <li><strong>Traitement cloud de secours</strong> : si la lecture locale échoue, l&apos;image de l&apos;offre peut être transmise de façon sécurisée, le temps de l&apos;analyse uniquement, à notre prestataire (API Google Gemini).</li>
        <li><strong>Non-exploitation des données des passagers</strong> : les éventuelles données de tiers visibles à l&apos;écran (prénom, adresse exacte d&apos;un passager) <strong>ne sont ni exploitées, ni revendues</strong>, et ne servent qu&apos;au calcul de rentabilité que vous demandez. Elles ne figurent jamais dans la télémétrie.</li>
      </ul>

      <h2>4. Finalités et bases légales</h2>
      <ul>
        <li><strong>Fournir le Service</strong> (scan, verdict, historique, statistiques, abonnement) — exécution du contrat.</li>
        <li><strong>Fiabiliser l&apos;OCR, prévenir la fraude et les abus, assurer la sécurité</strong> — intérêt légitime.</li>
        <li><strong>Notifications push et capture de diagnostic (bêta)</strong> — consentement, révocable à tout moment.</li>
        <li><strong>Obligations légales</strong> (comptables, demandes légitimes).</li>
      </ul>

      <h2>5. Destinataires et sous-traitants</h2>
      <p>Nous ne vendons aucune donnée et n&apos;affichons aucune publicité. Nous recourons à des sous-traitants techniques (art. 28 RGPD) strictement nécessaires :</p>
      <ul>
        <li><strong>Supabase</strong> — hébergement, base de données, authentification ;</li>
        <li><strong>Google (API Gemini)</strong> — traitement d&apos;image cloud de secours ;</li>
        <li><strong>Google (Firebase, Sign-In, Play)</strong> — notifications, connexion, distribution ;</li>
        <li><strong>TomTom</strong> — géolocalisation, géocodage et calcul d&apos;itinéraire ;</li>
        <li><strong>RevenueCat</strong> — gestion technique des abonnements (via les stores) ;</li>
        <li><strong>Apple</strong> — connexion et distribution App Store ;</li>
        <li><strong>Sentry</strong> — supervision des erreurs et plantages.</li>
      </ul>

      <h2>6. Transferts hors Union européenne</h2>
      <p>
        Vos données sont hébergées par <strong>Supabase</strong> dans la région{' '}
        <strong>eu-west-1 (Irlande)</strong>, soit au sein de l&apos;Union européenne. Certains
        prestataires (Google, Sentry…) peuvent traiter des données hors UE ; ces transferts sont
        encadrés par des garanties appropriées (clauses contractuelles types ou mécanisme
        équivalent), conformément aux articles 44 et suivants du RGPD.
      </p>

      <h2>7. Durées de conservation</h2>
      <ul>
        <li><strong>Compte, profil, courses (adresses incluses), sessions</strong> : tant que le compte est actif, pour vous fournir votre historique et vos statistiques ; supprimés à la suppression du compte ;</li>
        <li><strong>Captures de diagnostic (bêta)</strong> : 30 jours maximum ;</li>
        <li><strong>Télémétrie non nominative</strong> : conservée sous forme agrégée ;</li>
        <li><strong>Rapports d&apos;erreurs (Sentry)</strong> : selon la rétention du service (généralement 90 jours).</li>
      </ul>

      <h2>8. Vos droits</h2>
      <p>Conformément au RGPD, vous disposez des droits d&apos;accès (art. 15), de rectification (art. 16), d&apos;effacement (art. 17), de portabilité (art. 20), d&apos;opposition et de limitation (art. 18 et 21), et du droit de retirer votre consentement à tout moment. Vous pouvez :</p>
      <ul>
        <li>consulter et modifier vos données depuis l&apos;application ;</li>
        <li><strong>supprimer votre compte et l&apos;intégralité de vos données en une seule action</strong> depuis Profil → Compte (courses, sessions, véhicules, préférences, profil, photo et compte) ;</li>
        <li>nous écrire à <a href="mailto:contact@striveapp.fr">contact@striveapp.fr</a>.</li>
      </ul>
      <p>
        Vous pouvez introduire une réclamation auprès de la CNIL (
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer">cnil.fr</a>).
      </p>

      <h2>9. Sécurité</h2>
      <p>
        Échanges chiffrés en transit (HTTPS), accès aux données cloisonné par utilisateur (chacun
        n&apos;accède qu&apos;aux siennes), jetons d&apos;authentification stockés dans le coffre
        sécurisé du système (Keychain / Keystore), opérations sensibles contrôlées côté serveur.
      </p>

      <h2>10. Cookies (site web)</h2>
      <p>
        Le site de présentation n&apos;utilise pas de cookies publicitaires ni de traceurs de
        profilage.
      </p>

      <h2>11. Mineurs</h2>
      <p>Le Service s&apos;adresse à des chauffeurs VTC professionnels et n&apos;est pas destiné aux personnes de moins de 18 ans.</p>

      <h2>12. Modifications</h2>
      <p>Nous pouvons mettre à jour cette Politique. En cas de changement important, vous en serez informé dans l&apos;application ou par e-mail.</p>

      <h2>13. Contact</h2>
      <p>
        Pour toute question relative à vos données :{' '}
        <a href="mailto:contact@striveapp.fr">contact@striveapp.fr</a>.
      </p>
    </>
  );
}
