export const metadata = { title: 'Politique de confidentialité — Strive' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p className="!text-faint text-sm">Dernière mise à jour : 13 juin 2026</p>

      <p>
        Strive (« Strive », « nous ») est une application mobile d&apos;aide à la décision pour
        chauffeurs VTC. Cette politique explique quelles données nous traitons, pourquoi, avec qui,
        combien de temps, et quels sont tes droits. Elle s&apos;applique à l&apos;application iOS et
        Android ainsi qu&apos;à ce site.
      </p>

      <h2>1. Responsable du traitement</h2>
      <p>
        Le responsable du traitement est l&apos;éditeur de Strive&nbsp;:{' '}
        <strong>[À COMPLÉTER : raison sociale / nom de l&apos;éditeur, forme juridique, SIREN, adresse]</strong>.
        Pour toute question relative à tes données, écris-nous à{' '}
        <a href="mailto:supportstriveapp@gmail.com">supportstriveapp@gmail.com</a>.
      </p>

      <h2>2. Données que nous traitons</h2>
      <h3>Compte</h3>
      <ul>
        <li>Adresse e-mail et identifiant de compte.</li>
        <li>Méthode de connexion (e-mail / Google / Apple).</li>
      </ul>
      <h3>Profil &amp; véhicule</h3>
      <ul>
        <li>Marque, modèle, année, type de carburant et consommation moyenne de ton véhicule.</li>
        <li>Langue et fuseau horaire de l&apos;appareil.</li>
        <li>Préférences : seuils minimum €/h et €/km, heure de réinitialisation de journée, options d&apos;affichage.</li>
      </ul>
      <h3>Courses scannées</h3>
      <ul>
        <li>Plateforme (Uber, Bolt, Heetch…), tarif, distance, durée, statut (acceptée / refusée), horodatage.</li>
        <li>
          Adresses de prise en charge et de destination extraites de l&apos;offre (lorsqu&apos;elles
          sont présentes), utilisées pour calculer la distance/durée réelles et alimenter ton
          historique.
        </li>
        <li>Sessions de conduite : début, fin, durée.</li>
      </ul>
      <h3>Abonnement</h3>
      <ul>
        <li>
          Statut et type d&apos;abonnement, crédits de scan, identifiant technique fourni par notre
          prestataire de gestion d&apos;abonnement. <strong>Nous ne voyons ni ne stockons tes
          coordonnées bancaires</strong> : les paiements sont gérés par l&apos;App Store ou Google
          Play.
        </li>
      </ul>
      <h3>Notifications</h3>
      <ul>
        <li>Jeton de notification push (pour les rappels de session, recharge de quota, etc.).</li>
      </ul>
      <h3>Mesure de qualité &amp; diagnostic</h3>
      <ul>
        <li>
          <strong>Télémétrie non nominative</strong> : par scan, nous enregistrons des faits
          agrégeables (plateforme, nombre d&apos;adresses détectées, tranche de prix, verdict,
          recours ou non au moteur d&apos;analyse cloud). <strong>Jamais le montant exact, ni les
          adresses, ni de coordonnées.</strong>
        </li>
        <li>
          <strong>Capture de diagnostic (bêta, sur consentement)</strong> : lorsque l&apos;analyse
          locale ne parvient pas à lire une adresse, nous pouvons enregistrer les blocs de texte
          OCR de l&apos;écran scanné (qui peuvent contenir des adresses) afin de corriger
          l&apos;outil. Ces captures sont <strong>privées, visibles de toi seul, conservées 30 jours
          maximum</strong>, et réservées à la phase de test.
        </li>
        <li>Journaux techniques d&apos;actions sensibles et rapports d&apos;erreurs / plantages.</li>
      </ul>

      <h2>3. Le scan et les captures d&apos;écran</h2>
      <ul>
        <li>
          L&apos;analyse de l&apos;offre (OCR) se fait <strong>sur ton appareil</strong> (ML Kit sur
          Android, Vision sur iOS). <strong>Aucune capture d&apos;écran n&apos;est conservée</strong>.
        </li>
        <li>
          Sur Android, le scan s&apos;appuie sur le service d&apos;accessibilité et la capture
          d&apos;écran que tu autorises ; sur iOS, sur la capture que tu déclenches. Ces
          autorisations servent uniquement à lire l&apos;offre au moment du scan.
        </li>
        <li>
          <strong>Secours d&apos;analyse cloud</strong> : si la lecture locale échoue, l&apos;image
          de l&apos;offre est transmise de façon sécurisée à notre prestataire d&apos;analyse
          (Google Gemini) pour en extraire les informations, le temps de l&apos;analyse uniquement.
        </li>
        <li>
          <strong>Géocodage</strong> : les adresses textuelles peuvent être envoyées à notre
          prestataire cartographique (TomTom) pour calculer la distance et la durée réelles.
        </li>
      </ul>

      <h2>4. Finalités et bases légales (RGPD)</h2>
      <ul>
        <li><strong>Fournir le service</strong> (scan, verdict, historique, statistiques, abonnement) — exécution du contrat.</li>
        <li><strong>Améliorer la fiabilité de l&apos;OCR, prévenir la fraude et les abus, assurer la sécurité</strong> — intérêt légitime.</li>
        <li><strong>Notifications push et capture de diagnostic bêta</strong> — ton consentement (révocable à tout moment).</li>
        <li><strong>Obligations légales</strong> (comptables, réponses aux demandes légitimes).</li>
      </ul>

      <h2>5. Avec qui tes données sont partagées</h2>
      <p>Nous ne vendons aucune donnée et n&apos;affichons aucune publicité. Nous faisons appel à des sous-traitants techniques :</p>
      <ul>
        <li><strong>Supabase</strong> — hébergement, base de données, authentification.</li>
        <li><strong>RevenueCat</strong> — gestion des abonnements (via App Store / Google Play).</li>
        <li><strong>Google</strong> — analyse cloud de secours (Gemini), notifications (Firebase), connexion Google, distribution Play.</li>
        <li><strong>Apple</strong> — connexion Apple, distribution App Store.</li>
        <li><strong>TomTom</strong> — géocodage et calcul d&apos;itinéraire.</li>
        <li><strong>Sentry</strong> — supervision des erreurs et plantages.</li>
      </ul>
      <p>
        <strong>[À COMPLÉTER : localisation d&apos;hébergement des données (région Supabase) et
        encadrement des transferts hors Union européenne]</strong>. Certains prestataires (Google,
        Sentry…) peuvent traiter des données hors UE ; ces transferts sont encadrés par des clauses
        contractuelles types ou un mécanisme équivalent.
      </p>

      <h2>6. Durées de conservation</h2>
      <ul>
        <li><strong>Compte, profil, courses, sessions</strong> : conservés tant que ton compte existe ; supprimés à la suppression du compte.</li>
        <li><strong>Captures de diagnostic (bêta)</strong> : 30 jours maximum.</li>
        <li><strong>Télémétrie non nominative</strong> : conservée sous forme agrégée pour le suivi qualité.</li>
        <li><strong>Rapports d&apos;erreurs (Sentry)</strong> : selon la rétention du service (généralement 90 jours).</li>
      </ul>

      <h2>7. Sécurité</h2>
      <p>
        Les échanges sont chiffrés en transit (HTTPS). L&apos;accès aux données est cloisonné par
        utilisateur (chaque chauffeur n&apos;accède qu&apos;à ses propres données), les jetons
        d&apos;authentification sont stockés dans le coffre sécurisé du système (Keychain / Keystore),
        et les opérations sensibles sont contrôlées côté serveur.
      </p>

      <h2>8. Tes droits</h2>
      <p>
        Conformément au RGPD, tu disposes des droits d&apos;accès, de rectification, d&apos;effacement,
        de portabilité, de limitation et d&apos;opposition, ainsi que du droit de retirer ton
        consentement à tout moment. Tu peux :
      </p>
      <ul>
        <li>consulter et modifier tes données depuis l&apos;application ;</li>
        <li>
          <strong>supprimer ton compte et l&apos;ensemble de tes données</strong> en un geste depuis
          Profil → Compte (cela efface tes courses, sessions, véhicules, préférences, ton profil,
          ta photo et ton compte) ;
        </li>
        <li>nous contacter à <a href="mailto:supportstriveapp@gmail.com">supportstriveapp@gmail.com</a> pour exercer tes droits.</li>
      </ul>
      <p>
        Tu peux aussi introduire une réclamation auprès de la CNIL (
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer">cnil.fr</a>).
      </p>

      <h2>9. Mineurs</h2>
      <p>
        Strive s&apos;adresse à des chauffeurs VTC professionnels et n&apos;est pas destinée aux
        personnes de moins de 18 ans.
      </p>

      <h2>10. Modifications</h2>
      <p>
        Nous pouvons mettre à jour cette politique. En cas de changement important, nous t&apos;en
        informerons dans l&apos;application ou par e-mail. La date de dernière mise à jour figure en
        haut de cette page.
      </p>

      <h2>11. Contact</h2>
      <p>
        Pour toute question relative à tes données :{' '}
        <a href="mailto:supportstriveapp@gmail.com">supportstriveapp@gmail.com</a>.
      </p>
    </>
  );
}
