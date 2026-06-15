export const metadata = { title: 'Conditions Générales d\'Utilisation — Strive' };

export default function TermsPage() {
  return (
    <>
      <h1>Conditions Générales d&apos;Utilisation</h1>
      <p className="!text-faint text-sm">Dernière mise à jour : 13 juin 2026</p>

      <div className="!my-7 rounded-2xl border border-signal/30 bg-signal/[0.06] p-5 text-sm leading-relaxed text-fg">
        ⚠️ <strong>À retenir avant tout.</strong> Strive est un éditeur <strong>100 % indépendant</strong>.
        L&apos;Application n&apos;a <strong>aucun lien — de quelque nature que ce soit — avec Uber,
        Bolt, Heetch ou toute autre plateforme VTC</strong> : aucune affiliation, aucun partenariat,
        aucune approbation, aucun accès à leurs systèmes ou à leurs comptes. Strive
        <strong> n&apos;exploite, ne revend et ne cède aucune de vos données</strong> ni celles des
        passagers. Aucune publicité, aucun traçage publicitaire.
      </div>

      <h2>Préambule</h2>
      <p>
        Les présentes Conditions Générales d&apos;Utilisation (les « CGU ») constituent un contrat
        entre vous (l&apos;« Utilisateur ») et l&apos;éditeur de l&apos;application mobile Strive
        (l&apos;« Éditeur »). Elles régissent l&apos;accès et l&apos;utilisation de l&apos;application
        Strive et de ses services (l&apos;« Application » ou le « Service »). L&apos;Application est un
        outil d&apos;aide à la décision destiné aux chauffeurs VTC indépendants. En créant un compte,
        en installant ou en utilisant l&apos;Application, vous reconnaissez avoir lu, compris et
        accepté sans réserve les présentes CGU.
      </p>

      <h2>1. Définitions</h2>
      <ul>
        <li><strong>Application / Service</strong> : l&apos;application Strive, ses fonctionnalités, son site et ses services associés.</li>
        <li><strong>Utilisateur</strong> : toute personne physique majeure qui crée un compte et utilise l&apos;Application.</li>
        <li><strong>Plateformes Tierces</strong> : les services de mise en relation VTC utilisés par l&apos;Utilisateur (Uber, Bolt, Heetch…), indépendants de l&apos;Éditeur.</li>
        <li><strong>Scan</strong> : l&apos;action, déclenchée volontairement par l&apos;Utilisateur, par laquelle l&apos;Application lit l&apos;écran pour en extraire les caractéristiques d&apos;une proposition de course.</li>
        <li><strong>Verdict</strong> : l&apos;indication synthétique et les estimations (€/h, €/km, coût estimé, revenu net estimé) générées par l&apos;Application.</li>
      </ul>

      <h2>2. Identité de l&apos;Éditeur</h2>
      <p>
        L&apos;Application est éditée par :{' '}
        <strong>[À COMPLÉTER : raison sociale ou nom, forme juridique, SIREN/RCS, siège social, directeur de la publication]</strong>.
        Contact : <a href="mailto:supportstriveapp@gmail.com">supportstriveapp@gmail.com</a>.
      </p>

      <h2>3. Acceptation et modification des CGU</h2>
      <p>
        L&apos;Éditeur peut modifier les présentes CGU, notamment pour se conformer à toute évolution
        légale, réglementaire ou technique. En cas de modification substantielle, l&apos;Utilisateur
        en sera informé (notification dans l&apos;Application ou courriel). La poursuite de
        l&apos;utilisation vaut acceptation des CGU modifiées.
      </p>

      <h2>4. Description du Service</h2>
      <p>
        À la demande expresse de l&apos;Utilisateur, l&apos;Application lit la proposition de course
        affichée à l&apos;écran par reconnaissance optique de caractères (« OCR »), en extrait des
        métriques (tarif, distance, durée, adresses lorsque présentes), calcule des indicateurs de
        rentabilité (€/h, €/km, coût d&apos;usure et de carburant estimé, revenu net estimé) selon vos
        paramètres et des données de tiers, puis affiche un Verdict destiné à éclairer votre décision.
        Le Service est proposé selon un modèle Freemium (accès gratuit limité + abonnement « Strive
        Plus »).
      </p>

      <h2>5. Indépendance et non-affiliation</h2>
      <p>
        <strong>Strive est une entreprise totalement indépendante.</strong> L&apos;Éditeur
        n&apos;est en aucune manière affilié, partenaire, mandaté, sponsorisé, approuvé ni autrement
        lié à Uber, Bolt, Heetch ou à toute autre Plateforme Tierce, et ne dispose d&apos;aucun accès
        à leurs systèmes, API ou comptes. Les dénominations et marques des Plateformes Tierces
        appartiennent à leurs titulaires respectifs et ne sont citées qu&apos;à des fins descriptives
        d&apos;interopérabilité. Il appartient à l&apos;Utilisateur de s&apos;assurer que son usage de
        l&apos;Application est compatible avec les conditions des Plateformes Tierces ; l&apos;Éditeur
        ne saurait être tenu responsable d&apos;une mesure prise par celles-ci.
      </p>

      <h2>6. Accès, inscription et compte</h2>
      <ul>
        <li>Le Service est réservé aux personnes physiques <strong>majeures (18 ans révolus)</strong> exerçant ou souhaitant exercer une activité de chauffeur.</li>
        <li>L&apos;Utilisateur fournit des informations exactes et préserve la confidentialité de ses identifiants ; il est responsable de toute activité depuis son compte.</li>
        <li>Sont prohibés la création de comptes multiples destinée à contourner les quotas, ainsi que tout usage automatisé, frauduleux ou abusif.</li>
      </ul>

      <h2>7. Abonnements, achats et facturation</h2>
      <ul>
        <li><strong>Offre gratuite</strong> : accès assorti d&apos;un quota limité de Scans par jour.</li>
        <li><strong>Strive Plus</strong> : abonnement mensuel ou annuel (Scans illimités + fonctions avancées), avec une <strong>période d&apos;essai gratuite de 3 jours</strong>.</li>
        <li><strong>Packs de Scans</strong> : crédits ponctuels (achats non renouvelables).</li>
        <li><strong>Facturation via les stores</strong> : tous les paiements sont traités par l&apos;App Store (Apple) ou Google Play, selon leurs conditions. L&apos;Éditeur n&apos;a accès à aucune donnée bancaire.</li>
        <li><strong>Renouvellement automatique</strong> pour une période identique, sauf résiliation au moins 24 h avant la fin de la période en cours ; en cas d&apos;essai, facturation à l&apos;issue si non annulé à temps.</li>
        <li><strong>Résiliation</strong> à tout moment depuis les réglages d&apos;abonnement du store ; effet au terme de la période en cours.</li>
        <li><strong>Remboursements</strong> : selon la politique du store ; sauf disposition légale impérative, les périodes entamées ne sont pas remboursées.</li>
        <li><strong>Évolution tarifaire</strong> : applicable aux périodes futures et communiquée à l&apos;avance.</li>
      </ul>

      <h2>8. Obligations de l&apos;Utilisateur et usage acceptable</h2>
      <ul>
        <li>Utiliser le Service dans le respect des CGU, de la loi et des conditions des Plateformes Tierces, dont l&apos;Utilisateur demeure seul garant.</li>
        <li><strong>Ne pas manipuler l&apos;Application en conduisant</strong> : les Verdicts ne se consultent qu&apos;à l&apos;arrêt, en sécurité. L&apos;Utilisateur reste seul responsable du respect du Code de la route.</li>
        <li>Ne pas désassembler, décompiler, contourner les limitations techniques, ni perturber le Service.</li>
      </ul>

      <h2>9. Avertissement et limitation de responsabilité</h2>
      <p>
        <strong>Caractère indicatif.</strong> Les Verdicts, calculs de rentabilité, recommandations
        et estimations de revenus sont fournis <strong>à titre strictement informatif et
        indicatif</strong>. Ils résultent de la lecture automatisée d&apos;un écran et de données de
        tiers, susceptibles d&apos;imprécisions.
      </p>
      <p>
        <strong>Absence de garantie.</strong> L&apos;Application <strong>ne garantit aucun revenu ni
        aucun résultat</strong>. Elle ne constitue ni un conseil financier, comptable ou fiscal, et
        <strong> ne se substitue pas à un expert-comptable</strong>. L&apos;Utilisateur, chauffeur
        indépendant, <strong>demeure seul responsable</strong> de ses décisions d&apos;accepter ou de
        refuser une course et de la gestion de son activité.
      </p>
      <p>
        <strong>Fourniture « en l&apos;état ».</strong> Le Service est fourni « tel quel » et « selon
        disponibilité ». Il dépend de services tiers ; toute modification de leur part (ex. refonte
        d&apos;interface d&apos;une Plateforme Tierce) peut altérer temporairement la lecture des
        offres. Dans la limite permise par la loi, l&apos;Éditeur n&apos;est pas responsable des
        dommages indirects, pertes de gains ou d&apos;opportunité ; ces limitations ne s&apos;appliquent
        pas en cas de faute lourde ou dolosive.
      </p>

      <h2>10. Propriété intellectuelle</h2>
      <p>
        L&apos;Application, son code, sa marque, ses bases de données, ses contenus et son design sont
        protégés et demeurent la propriété exclusive de l&apos;Éditeur. L&apos;Utilisateur bénéficie
        d&apos;un droit d&apos;usage personnel, non exclusif et non cessible, limité à
        l&apos;utilisation conforme à la destination de l&apos;Application.
      </p>

      <h2>11. Données à caractère personnel</h2>
      <p>
        Le traitement de vos données est décrit dans notre{' '}
        <a href="/privacy">Politique de Confidentialité</a>, qui fait partie intégrante des présentes
        CGU.
      </p>

      <h2>12. Disponibilité et évolution</h2>
      <p>
        L&apos;Éditeur s&apos;efforce d&apos;assurer la disponibilité du Service sans en garantir la
        continuité ; il peut le suspendre pour maintenance, mise à jour ou sécurité, et en faire
        évoluer les fonctionnalités.
      </p>

      <h2>13. Suspension et résiliation</h2>
      <p>
        L&apos;Utilisateur peut supprimer son compte à tout moment depuis l&apos;Application.
        L&apos;Éditeur peut suspendre ou résilier un compte en cas de manquement aux CGU ou
        d&apos;usage frauduleux.
      </p>

      <h2>14. Droit applicable et litiges</h2>
      <p>
        Les présentes CGU sont régies par le <strong>droit français</strong>. Conformément aux
        articles L.611-1 et suivants du Code de la consommation, l&apos;Utilisateur consommateur peut
        recourir gratuitement à un médiateur de la consommation :{' '}
        <strong>[À COMPLÉTER : nom et coordonnées du médiateur]</strong>. La plateforme européenne de
        Règlement en Ligne des Litiges est accessible sur{' '}
        <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer">ec.europa.eu/consumers/odr</a>.
        À défaut de résolution amiable, les tribunaux français sont compétents.
      </p>

      <h2>15. Contact</h2>
      <p>
        Pour toute question : <a href="mailto:supportstriveapp@gmail.com">supportstriveapp@gmail.com</a>.
      </p>
    </>
  );
}
