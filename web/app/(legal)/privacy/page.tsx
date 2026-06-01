export const metadata = { title: 'Politique de confidentialité — Strive' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p>
        Strive respecte ta vie privée. Cette page résume comment nous traitons tes données. Pour
        toute question, contacte-nous à{' '}
        <a className="text-primary hover:underline" href="mailto:bouboullover6@gmail.com">
          bouboullover6@gmail.com
        </a>
        .
      </p>

      <h2>Données collectées</h2>
      <p>
        Strive analyse localement les captures d&apos;écran de tes apps VTC pour en extraire le
        prix, la distance et la durée. Aucune capture d&apos;écran n&apos;est stockée ni transmise.
        Tes courses (adresses, tarifs, statistiques) sont conservées de manière chiffrée pour
        alimenter ton historique et tes statistiques.
      </p>

      <h2>Utilisation</h2>
      <p>
        Tes données servent uniquement à fournir le service : calculer ton €/h, ton historique et
        tes statistiques. Aucune donnée n&apos;est vendue. Aucune publicité, aucun tracking tiers.
      </p>

      <h2>Conservation</h2>
      <p>
        Tes courses (adresses incluses) sont conservées 12 mois, puis les adresses sont
        automatiquement effacées. Tu peux supprimer ton compte et ton historique à tout moment
        depuis l&apos;app.
      </p>

      <h2>Tes droits</h2>
      <p>
        Conformément au RGPD, tu peux accéder, rectifier ou supprimer tes données à tout moment
        depuis l&apos;app ou en nous contactant.
      </p>
    </>
  );
}
