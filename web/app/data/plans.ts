// Source unique des paliers : la section Tarifs, le comparatif, le balisage
// Offer (JSON-LD), la FAQ et llms.txt lisent tous ce fichier. Deux copies
// divergeraient, et un balisage qui annonce un prix que la page n'affiche pas
// est traité comme du balisage trompeur.

/**
 * Strive Premium est en vente : l'app expose bien `strive_premium_monthly` /
 * `strive_premium_yearly` et l'entitlement `premium` (`src/services/iapService.ts:12`),
 * donc les cartes, le comparatif, le balisage Offer, la FAQ et les CGU peuvent
 * l'annoncer sans promettre ce qui ne s'achète pas.
 *
 * Repasser à `false` suffit à le retirer de TOUT le site d'un coup.
 */
export const PREMIUM_LIVE = true;

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

// Combien de mensualités l'annuel fait réellement payer, et l'équivalent mensuel
// qui va sous le prix. Les deux se calculent ici, à partir des seuls montants :
// les chaînes écrites à la main (« soit 7,49 € par mois », « 3 mois offerts »)
// ont survécu à un changement de grille de trop. Avec la grille App Store
// actuelle, Plus fait payer 9 mois sur 12 (89,99 ÷ 9,99) et Premium 8
// (159,99 ÷ 19,99, la promo posée sur l'annuel) : 3 et 4 mois offerts.
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

/** Équivalent mensuel d'un tarif annuel, arrondi au centime. */
export const monthlyEquivalent = (p: Plan) => eur(p.amount.yearly / 12);

/**
 * Douze mensualités, barrées à côté du tarif annuel. Sans ce repère, « 159,99 € »
 * se lit comme huit fois plus cher que « 19,99 € » au lieu de quatre mois de
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
    tagline: 'Pour une journée complète de service.',
    price: { monthly: '9,99 €', yearly: '89,99 €' },
    amount: { monthly: 9.99, yearly: 89.99 },
    suffix: { monthly: '/mois', yearly: '/an' },
    note: { monthly: 'Sans engagement', yearly: '' },
    points: [
      '20 scans par jour',
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
    price: { monthly: '19,99 €', yearly: '159,99 €' },
    amount: { monthly: 19.99, yearly: 159.99 },
    suffix: { monthly: '/mois', yearly: '/an' },
    note: { monthly: 'Sans engagement', yearly: '' },
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

// `note.yearly` est laissée vide dans la liste au-dessus : elle se déduit du
// montant annuel, et une valeur recopiée à la main finirait par le contredire.
export const ALL_PLANS: Plan[] = RAW_PLANS.map((p) =>
  p.amount.yearly > 0
    ? { ...p, note: { ...p.note, yearly: `soit ${monthlyEquivalent(p)} par mois` } }
    : p,
);

export const PLANS = ALL_PLANS.filter((p) => p.id !== 'premium' || PREMIUM_LIVE);

export const planById = (id: Plan['id']) => ALL_PLANS.find((p) => p.id === id)!;

// La pastille de la section Tarifs. Les paliers n'offrent pas le même nombre de
// mois (3 sur Plus, 4 sur Premium via la promo annuelle) : annoncer le plus
// grand sans « jusqu'à » promettrait à un futur abonné Plus un mois qu'il
// n'aura pas.
const FREE_MONTHS = PLANS.map(monthsFree).filter((m) => m > 0);
const MAX_FREE = Math.max(0, ...FREE_MONTHS);
export const SAVINGS_LABEL =
  FREE_MONTHS.length > 1 && new Set(FREE_MONTHS).size > 1
    ? `Jusqu'à ${MAX_FREE} mois offerts`
    : `${MAX_FREE} mois offerts`;

type ComparisonRow = { label: string; free: string; plus: string; premium: string };

// Le support prioritaire appartient à Premium SEUL : le trigger
// `20260901_support_priority.sql` pose `priority` à partir de
// `effective_tier(user) = 'premium'`. Annoncé sur Plus, c'était une promesse que
// l'app ne tient pas — et la file d'attente du support est l'endroit où le
// chauffeur s'en aperçoit, au pire moment.
const ALL_COMPARISON: ComparisonRow[] = [
  { label: 'Scans par jour',         free: '3',           plus: '20',          premium: 'Illimité' },
  { label: 'Seuils €/h et €/km',     free: 'Imposés',     plus: 'Les tiens',   premium: 'Les tiens' },
  { label: 'Carburant déduit',       free: '—',           plus: 'Par modèle',  premium: 'Par modèle' },
  { label: 'Historique des courses', free: "Aujourd'hui", plus: '7 jours',     premium: 'Illimité' },
  { label: 'Réglages véhicule',      free: 'Verrouillés', plus: 'Modifiables', premium: 'Modifiables' },
  { label: 'Support',                free: 'Standard',    plus: 'Standard',    premium: 'Prioritaire' },
];

// Tant que Premium n'est pas en vente, sa colonne est masquée — une ligne dont
// « Gratuit » et « Plus » disent la même chose ne distingue alors plus rien et
// n'a rien à faire dans un tableau comparatif. Elle revient d'elle-même le jour
// où `PREMIUM_LIVE` passe à `true`.
export const COMPARISON = ALL_COMPARISON.filter(
  (row) => PREMIUM_LIVE || row.free !== row.plus,
);
