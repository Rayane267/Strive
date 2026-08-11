// Données structurées JSON-LD.
//
// Objectif : que les moteurs génératifs (AI Overviews, ChatGPT, Perplexity)
// puissent citer Strive avec les bons faits plutôt que de les deviner à partir
// du texte marketing. Chaque valeur ici doit être vérifiable sur le site : un
// balisage qui affirme ce que la page ne montre pas est une raison de
// déclassement, pas un raccourci.
//
// Volontairement ABSENT : `aggregateRating` (aucune note réelle à déclarer) et
// `installUrl` / `downloadUrl` (les badges stores pointent encore sur `#`).
// Les ajouter dès que les fiches sont publiées.

import { faqs } from '../data/faq';

export const SITE_URL = 'https://striveapp.fr';
export const CONTACT_EMAIL = 'contact@striveapp.fr';

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#app`;

export const organizationSchema = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'Strive',
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/strive-logo.png`,
  },
  email: CONTACT_EMAIL,
  contactPoint: {
    '@type': 'ContactPoint',
    email: CONTACT_EMAIL,
    contactType: 'customer support',
    availableLanguage: ['French'],
  },
};

export const websiteSchema = {
  '@type': 'WebSite',
  '@id': SITE_ID,
  url: SITE_URL,
  name: 'Strive',
  inLanguage: 'fr-FR',
  publisher: { '@id': ORG_ID },
};

export const appSchema = {
  '@type': 'MobileApplication',
  '@id': APP_ID,
  name: 'Strive',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'Assistant de rentabilité pour chauffeurs VTC',
  operatingSystem: 'iOS, Android',
  inLanguage: ['fr-FR', 'en'],
  url: SITE_URL,
  publisher: { '@id': ORG_ID },
  description:
    "Strive scanne une offre de course Uber, Bolt ou Heetch affichée à l'écran et calcule en 2 secondes son taux horaire réel, trafic en temps réel et temps d'approche inclus, pour indiquer au chauffeur VTC si la course est rentable selon ses propres seuils.",
  featureList: [
    "Scan OCR d'une offre de course en 2 secondes",
    'Taux horaire €/h calculé avec le trafic en temps réel',
    "Temps d'approche jusqu'au client inclus dans le calcul",
    'Seuils €/h et €/km personnalisés par chauffeur',
    'Coût carburant déduit selon la consommation du véhicule (thermique ou électrique)',
    'Score qualité sur 100 par course',
    'Historique des courses et statistiques de revenus',
  ],
  // Indépendance revendiquée sur le site (et dans la politique de
  // confidentialité) : c'est le fait le plus souvent mal restitué quand un
  // moteur résume une app tierce liée à Uber.
  disambiguatingDescription:
    "Strive est un outil indépendant d'aide à la décision. Il n'est affilié ni à Uber, ni à Bolt, ni à Heetch, et n'accède à aucun compte chauffeur sur ces plateformes.",
  offers: [
    {
      '@type': 'Offer',
      name: 'Strive Gratuit',
      price: 0,
      priceCurrency: 'EUR',
      description: '3 scans par jour, estimations basiques, historique du jour.',
    },
    {
      '@type': 'Offer',
      name: 'Strive Plus — mensuel',
      price: 9.99,
      priceCurrency: 'EUR',
      description:
        "15 scans par jour, €/h en direct avec trafic temps réel, seuils personnalisés, historique complet. Essai gratuit de 7 jours, sans engagement.",
    },
    {
      '@type': 'Offer',
      name: 'Strive Plus — annuel',
      price: 89.99,
      priceCurrency: 'EUR',
      description: "Toutes les fonctions Strive Plus, soit 7,49 € par mois. Essai gratuit de 7 jours.",
    },
  ],
};

export const faqSchema = {
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/#faq`,
  inLanguage: 'fr-FR',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

/** Un seul `@graph` par page : les entités se référencent par `@id` au lieu d'être dupliquées. */
export function jsonLdGraph(...nodes: object[]) {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
