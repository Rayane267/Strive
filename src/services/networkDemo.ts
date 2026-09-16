// src/services/networkDemo.ts

/**
 * Le réseau entre chauffeurs — modèle de partage et jeu de démonstration.
 *
 * Deux choses vivent ici, et une seule est provisoire.
 *
 * **La répartition n'est pas de la démo.** 88 / 10 / 2 est la décision produit :
 * le chauffeur qui roule garde 88 % du prix convenu, celui qui a apporté la
 * course en touche 10 %, Strive en prend 2 %. C'est le chiffre que l'app doit
 * pouvoir montrer AVANT chaque publication, et c'est pour ça qu'il est calculé
 * ici plutôt que réécrit à la main dans chaque écran.
 *
 * **Les courses, elles, sont fausses** — aucun backend n'existe encore. Elles
 * sont regroupées en bas du fichier, sous une seule constante, pour qu'on voie
 * d'un coup d'œil ce qu'il faudra remplacer par une requête.
 */

import { formatMoney, decimalSeparator, type Market } from '../utils/market';

/**
 * Le réseau est EN SUSPENS — mis hors de portée pour la v1.
 *
 * Les courses affichées sont fausses (`DEMO_OFFERS`) et le partage 88/10/2
 * n'a aucun backend derrière lui. Une app soumise avec une fonctionnalité qui
 * montre des données de démonstration comme si elles étaient réelles se fait
 * retoquer sur la 2.1 (App Completeness) — et un chauffeur qui publierait une
 * course n'aurait personne en face.
 *
 * À `false`, ni la carte du Dashboard ni les deux routes n'existent : masquer
 * l'entrée ne suffirait pas, un `navigate` ou une restauration d'état
 * rouvriraient les écrans. Tout le reste du fichier est conservé tel quel — il
 * n'y a qu'à repasser à `true` le jour où le backend existe.
 */
export const RIDE_NETWORK_ENABLED = false;

/** Parts du prix convenu. Leur somme fait 1, et ce n'est pas négociable. */
export const SHARE = {
  /** Le chauffeur qui prend la course. */
  driver: 0.88,
  /** L'apporteur, celui qui avait le client au téléphone. */
  referrer: 0.1,
  /** Strive. */
  platform: 0.02,
} as const;

/**
 * Commission d'une plateforme classique, pour la ligne de comparaison.
 *
 * Ordre de grandeur public, pas un chiffre contractuel : l'écran le présente
 * comme « autour de », jamais comme un relevé.
 */
export const CLASSIC_PLATFORM_RATE = 0.25;

export interface FareSplit {
  fare: number;
  driver: number;
  referrer: number;
  platform: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Découpe un prix convenu en trois parts qui font EXACTEMENT ce prix.
 *
 * Les deux petites parts sont arrondies au centime, la part du chauffeur prend
 * le reste. Arrondir les trois indépendamment laisserait dériver un centime sur
 * certains montants — et un total qui ne retombe pas sur le prix annoncé au
 * client ruine précisément ce que cet écran cherche à établir.
 */
export function splitFare(fare: number): FareSplit {
  const safe = Number.isFinite(fare) && fare > 0 ? fare : 0;
  const platform = round2(safe * SHARE.platform);
  const referrer = round2(safe * SHARE.referrer);
  return {
    fare: round2(safe),
    platform,
    referrer,
    driver: round2(safe - platform - referrer),
  };
}

/** Prix saisi au clavier : « 52 », « 52,5 », « 52.50 ». */
export function parseFare(input: string): number {
  const v = parseFloat(input.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function money(value: number, market: Market, lang: string): string {
  // Le symbole suit le marché comme partout ailleurs. Les cartes de
  // démonstration décrivent encore des courses françaises — c'est le seul
  // réseau ouvert — mais un chauffeur suisse qui les ouvre lit au moins ses
  // montants dans SA monnaie, plutôt qu'un euro qui ne lui dit rien.
  return formatMoney(value, market, { decimals: 2, language: lang });
}

/**
 * Le même montant, coupé en deux pour l'afficher en chiffre héros : les
 * décimales reculent d'un ton et d'une taille, l'euro se lit d'un coup.
 */
export function moneyParts(value: number, lang: string) {
  const [int, dec] = value.toFixed(2).split('.');
  // La virgule décimale suit la LANGUE et non le marché : un chauffeur
  // londonien qui lit l'app en français écrit « 52,50 », pas « 52.50 ».
  return { int, dec, sep: decimalSeparator(lang) };
}

// ─── Identité de l'apporteur ─────────────────────────────────────────────────

/**
 * Jusqu'où nommer l'apporteur.
 *
 * La question n'a pas de réponse universelle, elle dépend de la taille du
 * réseau. Entre chauffeurs qui se connaissent déjà, le nom complet EST la
 * confiance : on accepte la course de quelqu'un, pas d'un identifiant. Passé le
 * cercle de connaissances, ce même nom devient une donnée personnelle diffusée à
 * des inconnus, à laquelle s'ajoute une adresse de prise en charge.
 *
 * Le compromis retenu par défaut est celui des places de marché qui ont eu à
 * trancher la même chose (BlaBlaCar, Uber) : **prénom + initiale**. Il reste
 * assez humain pour qu'on reconnaisse un collègue, assez court pour ne pas
 * identifier un inconnu — et ce que le nom complet apportait de garantie est
 * repris par le badge « vérifié » et le compteur de courses apportées, qui
 * disent la fiabilité sans dire l'identité.
 *
 * La constante reste ici, en un seul endroit, pour que la décision puisse être
 * montrée dans les deux sens plutôt que défendue en théorie.
 */
export type ReferrerNameMode = 'full' | 'firstInitial' | 'initials';

export const REFERRER_NAME_MODE: ReferrerNameMode = 'firstInitial';

export interface NetworkDriver {
  id: string;
  firstName: string;
  lastName: string;
  avatarId: string;
  /** Carte professionnelle VTC vérifiée. */
  verified: boolean;
  /** Courses déjà apportées au réseau — la réputation, sans le nom. */
  ridesShared: number;
}

export function referrerName(
  driver: NetworkDriver,
  mode: ReferrerNameMode = REFERRER_NAME_MODE,
): string {
  const initial = driver.lastName.charAt(0).toUpperCase();
  if (mode === 'full') return `${driver.firstName} ${driver.lastName}`;
  if (mode === 'initials') return `${driver.firstName.charAt(0).toUpperCase()}. ${initial}.`;
  return `${driver.firstName} ${initial}.`;
}

// ─── Jeu de démonstration ────────────────────────────────────────────────────
// À remplacer par la requête des offres ouvertes autour du chauffeur.

export interface NetworkOffer {
  id: string;
  pickup: string;
  dropoff: string;
  /** Prix convenu entre l'apporteur et le client. */
  fare: number;
  /** Distance et temps jusqu'à la PRISE EN CHARGE, pas la course elle-même. */
  toPickupKm: number;
  toPickupMin: number;
  tripKm: number;
  tripMin: number;
  postedMinAgo: number;
  referrer: NetworkDriver;
}

const KARIM: NetworkDriver = {
  id: 'd1', firstName: 'Karim', lastName: 'Bensalem',
  avatarId: 'preset:m2', verified: true, ridesShared: 34,
};
const LEA: NetworkDriver = {
  id: 'd2', firstName: 'Léa', lastName: 'Morel',
  avatarId: 'preset:f1', verified: true, ridesShared: 12,
};
const SOFIANE: NetworkDriver = {
  id: 'd3', firstName: 'Sofiane', lastName: 'Traoré',
  avatarId: 'preset:m1', verified: true, ridesShared: 61,
};
const CAMILLE: NetworkDriver = {
  id: 'd4', firstName: 'Camille', lastName: 'Duval',
  avatarId: 'preset:f0', verified: false, ridesShared: 3,
};

export const DEMO_OFFERS: NetworkOffer[] = [
  {
    id: 'o1',
    pickup: 'Gare de Lyon, Paris 12e',
    dropoff: 'Orly Terminal 4',
    fare: 52,
    toPickupKm: 1.2, toPickupMin: 4,
    tripKm: 21, tripMin: 27,
    postedMinAgo: 2,
    referrer: KARIM,
  },
  {
    id: 'o2',
    pickup: 'Place de la Bastille, Paris 11e',
    dropoff: 'Gare du Nord, Paris 10e',
    fare: 27.5,
    toPickupKm: 0.6, toPickupMin: 3,
    tripKm: 6.4, tripMin: 18,
    postedMinAgo: 6,
    referrer: LEA,
  },
  {
    id: 'o3',
    pickup: 'Pont de Sèvres, Boulogne',
    dropoff: 'Roissy CDG, Terminal 2E',
    fare: 68,
    toPickupKm: 3.4, toPickupMin: 9,
    tripKm: 38, tripMin: 46,
    postedMinAgo: 11,
    referrer: SOFIANE,
  },
  {
    id: 'o4',
    pickup: 'Gare Montparnasse, Paris 15e',
    dropoff: 'Issy-les-Moulineaux',
    fare: 19.9,
    toPickupKm: 2.1, toPickupMin: 7,
    tripKm: 4.8, tripMin: 14,
    postedMinAgo: 18,
    referrer: CAMILLE,
  },
];

/** Gains réseau de la semaine, les deux sens séparés. */
export const DEMO_WEEK = {
  /** Encaissé sur les courses prises au réseau. */
  taken: 128.4,
  ridesTaken: 3,
  /** Commissions touchées sur les courses apportées. */
  referral: 31.2,
  ridesReferred: 6,
};

/** Chauffeurs joignables autour d'une prise en charge — pour l'accusé de publication. */
export const DEMO_DRIVERS_NEARBY = 12;
