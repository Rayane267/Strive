// Source unique des paliers : la section Tarifs, le comparatif, le balisage
// Offer (JSON-LD), la FAQ et llms.txt lisent tous ce fichier. Deux copies
// divergeraient, et un balisage qui annonce un prix que la page n'affiche pas
// est traité comme du balisage trompeur.

export type Cycle = 'monthly' | 'yearly';

export type Plan = {
  id: 'free' | 'plus';
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

// Combien de mensualités l'annuel fait réellement payer, et l'équivalent mensuel
// qui va sous le prix. Les deux se calculent ici, à partir des seuls montants :
// les chaînes écrites à la main (« soit 7,49 € par mois », « 3 mois offerts »)
// ont survécu à un changement de grille de trop. Avec la grille App Store
// actuelle, Plus fait payer ~9 mois sur 12 (79,99 ÷ 8,99) : 3 mois offerts.
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

/** Équivalent mensuel d'un tarif annuel, arrondi au centime. */
export const monthlyEquivalent = (p: Plan) => eur(p.amount.yearly / 12);

/**
 * Douze mensualités, barrées à côté du tarif annuel. Sans ce repère, « 79,99 € »
 * se lit comme neuf fois plus cher que « 8,99 € » au lieu de trois mois de
 * moins — c'est le repère que l'app pose déjà sur sa carte annuelle
 * (`src/screens/SubscriptionScreen.tsx:527`). Rendu `null` quand l'annuel
 * n'économise rien : un prix barré qui vaut le prix affiché est un faux rabais.
 */
export const yearlyReference = (p: Plan) =>
  p.amount.monthly > 0 && p.amount.yearly < p.amount.monthly * 12
    ? eur(p.amount.monthly * 12)
    : null;

/** Mensualités épargnées sur un an : 12 − (annuel ÷ mensuel). */
export const monthsFree = (p: Plan) =>
  p.amount.monthly > 0 ? Math.round(12 - p.amount.yearly / p.amount.monthly) : 0;

const RAW_PLANS: Plan[] = [
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
    tagline: 'Se rembourse en une seule course.',
    price: { monthly: '8,99 €', yearly: '79,99 €' },
    amount: { monthly: 8.99, yearly: 79.99 },
    suffix: { monthly: '/mois', yearly: '/an' },
    note: { monthly: 'Sans engagement', yearly: '' },
    points: [
      'Scans illimités',
      'Tes seuils €/h et €/km, pas les nôtres',
      'Carburant déduit selon ton modèle',
      "7 jours d'historique et de stats",
      'Réglages véhicule débloqués',
    ],
    cta: 'Commencer mes 7 jours gratuits',
    footnote: {
      monthly: 'Puis 8,99 €/mois. Annulable avant la fin, en 1 clic.',
      yearly: 'Puis 79,99 €/an. Annulable avant la fin, en 1 clic.',
    },
    featured: true,
    tag: 'Populaire',
  },
];

// `note.yearly` est laissée vide dans la liste au-dessus : elle se déduit du
// montant annuel, et une valeur recopiée à la main finirait par le contredire.
export const ALL_PLANS: Plan[] = RAW_PLANS.map((p) =>
  p.amount.yearly > 0
    ? { ...p, note: { ...p.note, yearly: `soit ${monthlyEquivalent(p)} par mois` } }
    : p,
);

export const PLANS = ALL_PLANS;

export const planById = (id: Plan['id']) => ALL_PLANS.find((p) => p.id === id)!;

// La pastille de la section Tarifs. Si plusieurs paliers payants offrent un
// nombre de mois différent, annoncer le plus grand sans « jusqu'à » promettrait
// un mois que certains n'auront pas.
const FREE_MONTHS = PLANS.map(monthsFree).filter((m) => m > 0);
const MAX_FREE = Math.max(0, ...FREE_MONTHS);
export const SAVINGS_LABEL =
  FREE_MONTHS.length > 1 && new Set(FREE_MONTHS).size > 1
    ? `Jusqu'à ${MAX_FREE} mois offerts`
    : `${MAX_FREE} mois offerts`;

type ComparisonRow = { label: string; free: string; plus: string };

// Une ligne où « Gratuit » et « Plus » disent la même chose ne distingue rien :
// elle n'a rien à faire dans un tableau comparatif.
export const COMPARISON: ComparisonRow[] = [
  { label: 'Scans par jour',         free: '3',           plus: 'Illimités' },
  { label: 'Seuils €/h et €/km',     free: 'Imposés',     plus: 'Les tiens' },
  { label: 'Carburant déduit',       free: '—',           plus: 'Par modèle' },
  { label: 'Historique des courses', free: "Aujourd'hui", plus: '7 jours' },
  { label: 'Réglages véhicule',      free: 'Verrouillés', plus: 'Modifiables' },
];
