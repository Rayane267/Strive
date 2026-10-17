import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Supprimer son compte — Strive',
  description:
    "Comment supprimer votre compte Strive – Assistant VTC et vos données, depuis l'application ou par e-mail, et ce qui est conservé après suppression.",
  alternates: { canonical: '/suppression-compte' },
};

export default function AccountDeletionPage() {
  return (
    <>
      <h1>Supprimer votre compte Strive</h1>
      <p className="!text-faint text-sm">Application Strive – Assistant VTC · Dernière mise à jour : 16 octobre 2026</p>

      <p>
        Vous pouvez supprimer votre compte Strive et les données qui y sont liées à tout moment,
        depuis l&apos;application ou, si vous ne l&apos;avez plus, par e-mail.
      </p>

      <h2>1. Depuis l&apos;application</h2>
      <ul>
        <li>Ouvrez l&apos;onglet <strong>Profil</strong> ;</li>
        <li>en bas de l&apos;écran, appuyez sur <strong>Supprimer mon compte</strong> ;</li>
        <li>confirmez. La suppression est immédiate et irréversible.</li>
      </ul>

      <h2>2. Sans l&apos;application, par e-mail</h2>
      <p>
        Écrivez à <a href="mailto:contact@striveapp.fr?subject=Suppression%20de%20compte">contact@striveapp.fr</a>{' '}
        avec pour objet <strong>« Suppression de compte »</strong>, depuis l&apos;adresse e-mail de votre
        compte Google ou Apple (ou en l&apos;indiquant dans le message). Nous supprimons le compte et
        vous le confirmons sous 30 jours au plus.
      </p>

      <h2>3. Ce qui est supprimé</h2>
      <ul>
        <li>votre compte et votre profil (prénom, photo, adresse e-mail) ;</li>
        <li>vos courses scannées, adresses comprises, et vos statistiques ;</li>
        <li>vos sessions de conduite, véhicules et préférences ;</li>
        <li>vos captures de diagnostic et vos demandes au support.</li>
      </ul>

      <h2>4. Ce qui est conservé</h2>
      <ul>
        <li>
          <strong>Mesures de scan anonymisées</strong> (plateforme, version, motif d&apos;échec, tranche de
          prix) : détachées de votre compte, conservées pour améliorer la lecture des offres ;
        </li>
        <li>
          <strong>Identifiant technique de l&apos;appareil</strong> et compteur de scans gratuits : détachés
          de votre compte, conservés pour éviter qu&apos;un même appareil ne recrée des comptes pour
          obtenir de nouveaux scans gratuits ;
        </li>
        <li>
          <strong>Journaux de sécurité</strong> : détachés de votre compte ;
        </li>
        <li>
          <strong>Rapports d&apos;erreurs</strong> (Sentry) : effacés selon la rétention du service,
          généralement 90 jours ;
        </li>
        <li>
          <strong>Historique d&apos;achat</strong> : conservé par Google Play, l&apos;App Store et notre
          prestataire d&apos;abonnement, au titre de leurs obligations comptables.
        </li>
      </ul>
      <p>
        <strong>Supprimer votre compte ne résilie pas votre abonnement.</strong> Résiliez-le d&apos;abord
        dans Google Play (Paiements et abonnements) ou dans les réglages de votre identifiant Apple.
      </p>

      <h2>5. Supprimer une partie de vos données seulement</h2>
      <ul>
        <li>
          <strong>Historique des courses</strong> : Profil → <strong>Modifier le profil</strong> →{' '}
          <strong>Supprimer mon historique</strong>. Toutes vos courses (adresses, tarifs, statistiques)
          sont effacées, le compte reste actif ;
        </li>
        <li>
          <strong>Captures de diagnostic</strong> et toute autre donnée : écrivez à{' '}
          <a href="mailto:contact@striveapp.fr">contact@striveapp.fr</a>.
        </li>
      </ul>

      <p>
        Le détail de nos traitements figure dans notre{' '}
        <a href="/privacy">politique de confidentialité</a>.
      </p>
    </>
  );
}
