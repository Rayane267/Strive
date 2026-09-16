export const metadata = {
  title: 'Mentions légales — Strive',
  description:
    'Identité de l\'éditeur, du directeur de la publication et de l\'hébergeur du site striveapp.fr.',
};

export default function LegalNoticePage() {
  return (
    <>
      <h1>Mentions légales</h1>
      <p className="!text-faint text-sm">Dernière mise à jour : 16 septembre 2026</p>

      <p>
        Conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l&apos;économie
        numérique (LCEN), les informations suivantes sont portées à la connaissance des
        utilisateurs du site <strong>striveapp.fr</strong> et de l&apos;application Strive.
      </p>

      <h2>1. Éditeur du site</h2>
      <ul>
        <li><strong>Rayane TALEB</strong>, entrepreneur individuel (auto-entrepreneur) ;</li>
        <li>Siège social : 5 allée de la Caravelle, 94430 Chennevières-sur-Marne, France ;</li>
        <li>SIREN : 988 905 394 ;</li>
        <li>
          Contact : <a href="mailto:contact@striveapp.fr">contact@striveapp.fr</a>
          {' '}(téléphone : À COMPLÉTER) ;
        </li>
        <li>TVA non applicable, article 293 B du Code général des impôts.</li>
      </ul>

      <h2>2. Directeur de la publication</h2>
      <p>Rayane TALEB, en qualité d&apos;éditeur.</p>

      <h2>3. Hébergeur</h2>
      <p>Le site est hébergé par :</p>
      <ul>
        <li><strong>Vercel Inc.</strong> ;</li>
        <li>440 N Barranca Ave #4133, Covina, CA 91723, États-Unis ;</li>
        <li>
          <a href="https://vercel.com" target="_blank" rel="noreferrer">vercel.com</a>
        </li>
      </ul>
      <p>
        Les données des utilisateurs de l&apos;application sont pour leur part hébergées par{' '}
        <strong>Supabase</strong> dans la région <strong>eu-west-1 (Irlande)</strong>, au sein de
        l&apos;Union européenne — voir la{' '}
        <a href="/privacy">Politique de Confidentialité</a>.
      </p>

      <h2>4. Propriété intellectuelle</h2>
      <p>
        L&apos;ensemble des contenus de ce site (textes, visuels, logo, code, marque « Strive »)
        est protégé par le droit de la propriété intellectuelle et demeure la propriété exclusive
        de l&apos;éditeur, sauf mention contraire. Toute reproduction ou représentation, totale ou
        partielle, sans autorisation écrite préalable est interdite.
      </p>
      <p>
        Les marques Uber, Bolt et Heetch appartiennent à leurs titulaires respectifs et ne sont
        citées qu&apos;à titre descriptif. <strong>Strive est un éditeur indépendant, sans aucun
        lien ni affiliation avec ces plateformes.</strong>
      </p>

      <h2>5. Données personnelles et cookies</h2>
      <p>
        Le traitement des données personnelles est décrit dans notre{' '}
        <a href="/privacy">Politique de Confidentialité</a>. Le site de présentation n&apos;utilise
        ni cookie publicitaire, ni traceur de profilage : la mesure d&apos;audience est réalisée
        sans cookie et sans identifiant persistant.
      </p>

      <h2>6. Conditions d&apos;utilisation</h2>
      <p>
        L&apos;utilisation du Service est régie par nos{' '}
        <a href="/terms">Conditions Générales d&apos;Utilisation</a>.
      </p>

      <h2>7. Médiation et litiges</h2>
      <p>
        En cas de litige, l&apos;utilisateur peut recourir gratuitement à la plateforme de règlement
        en ligne des litiges de la Commission européenne :{' '}
        <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer">
          ec.europa.eu/consumers/odr
        </a>
        . À défaut d&apos;accord amiable, les tribunaux français sont compétents.
      </p>

      <h2>8. Contact</h2>
      <p>
        Pour toute question :{' '}
        <a href="mailto:contact@striveapp.fr">contact@striveapp.fr</a>.
      </p>
    </>
  );
}
