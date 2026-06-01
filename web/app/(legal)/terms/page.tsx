export const metadata = { title: 'Conditions d\'utilisation — Strive' };

export default function TermsPage() {
  return (
    <>
      <h1>Conditions d&apos;utilisation</h1>
      <p>
        En utilisant Strive, tu acceptes les présentes conditions. Pour toute question, contacte-nous
        à{' '}
        <a className="text-primary hover:underline" href="mailto:bouboullover6@gmail.com">
          bouboullover6@gmail.com
        </a>
        .
      </p>

      <h2>Service</h2>
      <p>
        Strive est un outil d&apos;aide à la décision pour chauffeurs VTC. Les verdicts et
        estimations (€/h, €/km, coût carburant) sont indicatifs et ne garantissent pas de gains.
        Tu restes seul responsable de tes décisions d&apos;acceptation de course.
      </p>

      <h2>Abonnement</h2>
      <p>
        Strive Plus est proposé avec un essai gratuit de 3 jours, puis renouvelé automatiquement au
        tarif en vigueur. Tu peux annuler à tout moment depuis les réglages de l&apos;App Store ou
        Google Play, sans frais.
      </p>

      <h2>Utilisation acceptable</h2>
      <p>
        Tu t&apos;engages à utiliser Strive conformément aux conditions des plateformes VTC tierces
        (Uber, Bolt, Heetch) et à la législation applicable.
      </p>

      <h2>Responsabilité</h2>
      <p>
        Strive est fourni « tel quel ». Nous ne pouvons être tenus responsables des décisions prises
        sur la base des estimations fournies.
      </p>
    </>
  );
}
