// Source unique des paliers : la section Tarifs, le comparatif, le balisage
// Offer (JSON-LD), la FAQ et llms.txt lisent tous ce fichier. Deux copies
// divergeraient, et un balisage qui annonce un prix que la page n'affiche pas
// est traité comme du balisage trompeur.

/**
 * Strive Premium est entièrement écrit — cartes, comparatif, balisage, FAQ —
 * mais ne se vend qu'un à deux mois après le lancement de l'app. Tant que ce
 * booléen est `false`, le site ne le mentionne nulle part : ni carte, ni colonne
 * de comparatif, ni Offer JSON-LD, ni ligne dans llms.txt ou les CGU.
 *
 * Le jour du lancement, il n'y a qu'une chose à faire ici : passer à `true`.
 */
export const PREMIUM_LIVE = false;

export type Cycle = 'monthly' | 'yearly';

export type Plan = {
  id: 'free' | 'plus' | 'premium';
  name: string;
  tagline: string;
  price: Record<Cycle, string>;
  /** Valeur numérique pour le balisage Offer — doit refléter `price`. */
  amount: Record<Cycle, number>;
  suffix: Record<Cycle, string>;
  /** Ligne sous le prix : équivalent mensuel en annuel, réassurance en mensuel. */
  note: Record<Cycle, string>;
  points: string[];
  cta: string;
  footnote?: Record<Cycle, string>;
  featured?: boolean;
  tag?: string;
};

// 89,99 € = 9 mensualités de 9,99 € ; 219,99 € < 9 × 24,99 €. Dans les deux cas
// l'annuel revient à payer neuf mois pour douze — « 3 mois offerts » est donc
// littéralement vrai, là où le « −33 % » affiché jusqu'ici ne l'était pas
// (89,99 € sur 119,88 €, c'est −25 %).
export const ALL_PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Gratuit',
    tagline: 'Pour voir ce que Strive dit de tes courses.',
    price: { monthly: '0 €', yearly: '0 €' },
    amount: { monthly: 0, yearly: 0 },
    // Pas de périodicité sur le gratuit : « 0 €/an » en vue annuelle se lisait
    // comme une offre à durée limitée. Le prix se suffit à lui-même.
    suffix: { monthly: '', yearly: '' },
    note: { monthly: 'Sans carte bancaire', yearly: 'Sans carte bancaire' },
    points: [
      '3 scans par jour',
      '€/h et €/km sur chaque course',
      'Seuils de rentabilité par défaut',
      'Historique du jour',
    ],
    cta: 'Télécharger gratuitement',
  },
  {
    id: 'plus',
    name: 'Strive Plus',
    tagline: 'Pour une journée complète de service.',
    price: { monthly: '9,99 €', yearly: '89,99 €' },
    amount: { monthly: 9.99, yearly: 89.99 },
    suffix: { monthly: '/mois', yearly: '/an' },
    note: { monthly: 'Sans engagement', yearly: 'soit 7,49 € par mois' },
    points: [
      '30 scans par jour',
      'Tes seuils €/h et €/km, pas les nôtres',
      'Carburant déduit selon ton modèle',
      "7 jours d'historique et de stats",
      'Réglages véhicule débloqués',
    ],
    cta: 'Commencer mes 7 jours gratuits',
    footnote: {
      monthly: 'Puis 9,99 €/mois. Annulable avant la fin, en 1 clic.',
      yearly: 'Puis 89,99 €/an. Annulable avant la fin, en 1 clic.',
    },
    featured: true,
    tag: 'Populaire',
  },
  {
    id: 'premium',
    name: 'Strive Premium',
    tagline: 'Pour ceux qui scannent toute la journée.',
    price: { monthly: '24,99 €', yearly: '219,99 €' },
    amount: { monthly: 24.99, yearly: 219.99 },
    suffix: { monthly: '/mois', yearly: '/an' },
    note: { monthly: 'Sans engagement', yearly: 'soit 18,33 € par mois' },
    points: [
      'Tout ce que contient Plus',
      'Scans illimités',
      'Historique et stats sans limite de date',
      'Support prioritaire',
    ],
    cta: 'Passer en illimité',
    tag: 'Illimité',
  },
];

export const PLANS = ALL_PLANS.filter((p) => p.id !== 'premium' || PREMIUM_LIVE);

type ComparisonRow = { label: string; free: string; plus: string; premium: string };

export const COMPARISON: ComparisonRow[] = [
  { label: 'Scans par jour',         free: '3',           plus: '30',          premium: 'Illimité' },
  { label: 'Seuils €/h et €/km',     free: 'Imposés',     plus: 'Les tiens',   premium: 'Les tiens' },
  { label: 'Carburant déduit',       free: '—',           plus: 'Par modèle',  premium: 'Par modèle' },
  { label: 'Historique des courses', free: "Aujourd'hui", plus: '7 jours',     premium: 'Illimité' },
  { label: 'Réglages véhicule',      free: 'Verrouillés', plus: 'Modifiables', premium: 'Modifiables' },
  { label: 'Support',                free: 'Standard',    plus: 'Prioritaire', premium: 'Prioritaire' },
];
