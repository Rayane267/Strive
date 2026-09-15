/**
 * Ce qui change d'un pays à l'autre — devise, unité de distance, carburant,
 * cotisations sociales.
 *
 * Tout le calcul de Strive était français sans le dire : le prix du carburant
 * lisait la ligne `paris` de `fuel_prices`, les taux de `SOCIAL_RATES` étaient
 * ceux de l'Urssaf, et l'euro comme le kilomètre étaient écrits en dur à 128 et
 * 33 endroits. Un chauffeur londonien obtenait donc un seuil calculé au gazole
 * parisien et aux cotisations françaises : un chiffre faux, présenté avec la
 * même assurance qu'un vrai.
 *
 * Ce module est la seule source de ces différences. Ajouter un pays, c'est
 * ajouter une entrée ici — pas chercher les endroits où le drapeau manquait.
 *
 * ── LE PAYS SE LIT SUR LA RÉGION, PAS SUR LA LANGUE ────────────────────────
 * La langue ne peut pas désigner le pays, et surtout pas sur ces marchés-là :
 * `fr` ne sépare pas la France de la Belgique ni de la Suisse, `nl` ne sépare
 * pas les Pays-Bas de la Belgique, `pt` couvre le Brésil et `es` toute
 * l'Amérique latine. `Intl.DateTimeFormat().resolvedOptions().locale` porte les
 * deux (« fr-BE ») : `i18n.ts` en prend la langue, on en prend la région.
 *
 * La détection reste une VALEUR PAR DÉFAUT. Un chauffeur peut rouler à Bruxelles
 * avec un téléphone configuré en France, et c'est son pays d'activité qui
 * détermine ses cotisations — d'où le réglage manuel qui prime (`profiles.country`).
 */

// `i18n` pour la seule langue courante — aucun cycle : `i18n.ts` n'importe rien
// d'ici.
import i18n from '../i18n';

/** Pays couverts. L'ordre suit l'ouverture des marchés. */
export type CountryCode = 'FR' | 'BE' | 'CH' | 'ES' | 'PT' | 'GB';

export type Currency = 'EUR' | 'CHF' | 'GBP';

/**
 * Le Royaume-Uni compte en miles — dans l'app Uber comme dans la tête du
 * chauffeur. Un « £/km » ne lui dit rien : on ne convertit pas pour l'affichage,
 * on raisonne dans son unité, seuil compris.
 */
export type DistanceUnit = 'km' | 'mi';

export const KM_PER_MILE = 1.609344;

/**
 * Un régime social, réduit à ce dont le seuil a besoin : combien part, et sur
 * quoi.
 *
 * `base` n'est pas un détail comptable, c'est ce qui rend deux taux comparables
 * ou non. 21,2 % du chiffre d'affaires français et 20,5 % du revenu net belge
 * se ressemblent et ne portent pas sur la même chose : le second se calcule
 * APRÈS déduction du carburant, du leasing et des péages. Posés côte à côte
 * sans leur base, ils feraient conclure que la Belgique coûte autant que la
 * France, ce qui est faux — c'est le même piège que l'écran de statut de
 * l'onboarding règle déjà en rappelant la base sous chaque option.
 */
export type SocialRegime = {
  /** Clé de traduction : `onboarding.status.<id>`. */
  id: string;
  /** Part prélevée, appliquée à `base`. 0 = rien à reverser soi-même. */
  rate: number;
  /**
   * `revenue` : le taux porte sur le chiffre d'affaires brut, rien n'est
   * déductible. `profit` : il porte sur ce qui reste une fois les charges
   * déduites.
   */
  base: 'revenue' | 'profit';
  /**
   * Vrai quand le pays prélève une cotisation FORFAITAIRE mensuelle et non un
   * pourcentage (l'Espagne). On n'invente alors pas de montant : le chauffeur
   * connaît sa cuota au centime près, et l'onboarding la lui fait ranger dans
   * ses charges fixes — là où elle se comporte exactement comme une assurance
   * ou une LOA.
   */
  flatInFixedCosts?: boolean;
};

/**
 * Plancher de rentabilité et échelle horaire → distance.
 *
 * Ce ne sont PAS des constantes physiques : le plancher est ce que l'app impose
 * au palier gratuit, et l'échelle cale le kilométrique sur l'horaire faute de
 * connaître la vitesse moyenne du chauffeur à l'onboarding.
 */
export type Thresholds = {
  /** Plancher horaire, dans la devise du marché. */
  hourly: number;
  /** Plancher par unité de distance (par km, ou par mile au Royaume-Uni). */
  distance: number;
  /** Paliers horaire → distance, du plus modeste au plus exigeant. */
  scale: ReadonlyArray<{ hourly: number; distance: number }>;
};

export type Market = {
  country: CountryCode;
  currency: Currency;
  /** Symbole affiché. Le format (avant/après, espace) est dans `formatMoney`. */
  symbol: string;
  distanceUnit: DistanceUnit;
  /**
   * Ligne de `fuel_prices` à lire, ou `null` si le chauffeur saisit lui-même son
   * prix au litre (Paramètres → Véhicule).
   *
   * Seule la France a une source : un relevé quotidien y alimente la ligne
   * `paris`. Ailleurs, il faudrait bâtir ce relevé pour cinq pays avant d'ouvrir
   * quoi que ce soit — ou semer des moyennes inventées dans la table qui calcule
   * le bénéfice net de chaque course. Le chauffeur, lui, connaît le prix de SA
   * station, et c'est de toute façon plus juste qu'une moyenne nationale : il
   * fait le plein toujours au même endroit.
   */
  fuelKey: string | null;
  /** Langues à proposer, la première étant le défaut du marché. */
  locales: string[];
  /** Régimes proposés à l'onboarding, dans l'ordre d'affichage. */
  regimes: SocialRegime[];
  thresholds: Thresholds;
};

/**
 * BASE DE RÉFÉRENCE : 25 de l'heure, 1,00 de la distance.
 *
 * Deux chiffres ronds, et c'est le but. Le seuil de rentabilité n'est pas une
 * mesure de physicien : c'est le repère à partir duquel une course cesse de
 * payer le siège, et un repère doit se retenir. 1,00 se compare de tête à
 * n'importe quel tarif affiché ; 1,10 demandait un calcul à chaque course.
 *
 * Tout le reste s'en déduit par MULTIPLE — les paliers du tutoriel comme les
 * autres marchés.
 */
const BASE = { hourly: 25, distance: 1.0 } as const;

/**
 * Paliers Débutant / Standard / Exigeant, en multiples de la base.
 *
 * L'écart entre deux paliers dit « un cran plus exigeant », et ce cran-là ne
 * dépend ni du pays ni de la devise. Seul le point de départ en dépend.
 */
const SCALE_STEPS = [
  { hourly: 1, distance: 1 },
  { hourly: 1.28, distance: 1.25 },
  { hourly: 1.68, distance: 1.55 },
] as const;

const round05 = (n: number) => Math.round(n * 2) / 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Le barème d'un marché : la base, fois un multiple, DANS SA DEVISE.
 *
 * Le multiple porte les deux choses à la fois — le niveau du marché et sa
 * monnaie. Un plancher à 15 €/h en Belgique et à 23 CHF/h en Suisse ne se
 * compare pas terme à terme, et n'a pas à l'être : chacun se lit dans l'argent
 * que le chauffeur encaisse.
 *
 * TOUJOURS PAR KILOMÈTRE, Y COMPRIS AU ROYAUME-UNI. Le seuil est comparé à
 * `tarif / distance_km`, et cette division se fait en kilomètres partout — les
 * parsers convertissent les miles dès la lecture, et `rides.distance_km` ne
 * stocke que des kilomètres. Un seuil déjà exprimé par mile se retrouvait donc
 * comparé à un taux par kilomètre : la barre britannique était 1,6× trop haute,
 * et une course correcte passait pour un refus. Le mile n'apparaît qu'à
 * l'affichage, via `toMarketRate`.
 */
function thresholdsFrom(multiplier: number): Thresholds {
  const hourly = round05(BASE.hourly * multiplier);
  const distance = round2(BASE.distance * multiplier);
  return {
    hourly,
    distance,
    scale: SCALE_STEPS.map(step => ({
      hourly: round05(hourly * step.hourly),
      distance: round2(distance * step.distance),
    })),
  };
}

/**
 * TAUX DE COTISATIONS SOCIALES UNIQUEMENT — pas l'impôt sur le revenu.
 *
 * C'est le périmètre qu'avait déjà `SOCIAL_RATES`, et il faut s'y tenir pour
 * que les pays restent comparables : l'impôt est progressif et dépend du foyer,
 * pas seulement de l'activité. Le seuil sort donc un peu bas dans les pays où
 * l'impôt mord tôt — sens prudent, jamais l'inverse — et le curseur de
 * Préférences reste là pour l'ajuster.
 *
 * Chaque taux porte sa source dans le commentaire qui le précède. Un taux sans
 * source est un taux inventé, et celui-ci décide de quelles courses un chauffeur
 * refuse.
 */
export const MARKETS: Record<CountryCode, Market> = {
  FR: {
    country: 'FR',
    currency: 'EUR',
    symbol: '€',
    distanceUnit: 'km',
    fuelKey: 'paris',
    locales: ['fr'],
    regimes: [
      // 21,2 % du CA — micro-BIC « prestations de services commerciales »,
      // taux Urssaf 2026. Rien n'est déductible de cette base.
      { id: 'auto', rate: 0.212, base: 'revenue' },
      // ~45 % de l'enveloppe de rémunération (SASU ~46 %, EURL gérant
      // majoritaire ~45 %).
      { id: 'company', rate: 0.45, base: 'profit' },
      { id: 'employee', rate: 0, base: 'revenue' },
    ],
    // ×1 — la référence : 25 €/h et 1,00 €/km. Le brut horaire réellement
    // observé est de 23–29 €/h, et le minimum réglementaire de 30 € par heure
    // d'activité : le plancher se pose juste dessous. C'est un plancher, pas un
    // objectif.
    thresholds: thresholdsFrom(1),
  },

  BE: {
    country: 'BE',
    currency: 'EUR',
    symbol: '€',
    distanceUnit: 'km',
    fuelKey: null,
    // Bruxelles est bilingue et les deux communautés roulent : proposer l'une
    // sans l'autre exclut la moitié du marché.
    locales: ['fr', 'nl'],
    regimes: [
      // 20,5 % du revenu net imposable pour un indépendant à titre principal
      // (barème INASTI 2026, jusqu'à 75 024,54 € ; 14,16 % au-delà). Net
      // imposable = après déduction des frais professionnels, d'où `profit`.
      { id: 'independent', rate: 0.205, base: 'profit' },
      { id: 'company', rate: 0.45, base: 'profit' },
      { id: 'employee', rate: 0, base: 'revenue' },
    ],
    // ×0,6 → 15 €/h, 0,60 €/km. 1 800–3 500 €/mois à temps plein (indépendant,
    // Belgique) ≈ 10–20 €/h sur 173 h : le plancher vise le bas de la fourchette.
    thresholds: thresholdsFrom(0.6),
  },

  CH: {
    country: 'CH',
    currency: 'CHF',
    symbol: 'CHF',
    distanceUnit: 'km',
    fuelKey: null,
    locales: ['fr', 'de', 'it'],
    regimes: [
      // 10,6 % AVS/AI/APG sur le revenu net de l'activité indépendante (taux
      // plein dès CHF 60 500/an ; barème dégressif en dessous). Les frais
      // d'administration et les PC portent l'effectif un peu au-dessus.
      { id: 'independent', rate: 0.106, base: 'profit' },
      { id: 'employee', rate: 0, base: 'revenue' },
    ],
    // ×0,92 → 23 CHF/h, 0,92 CHF/km. Le marché tourne à 27 CHF/h en moyenne NET
    // DE COMMISSION, minimum observé 23 (Genève, Zurich). C'est bien cette
    // valeur-là qu'il faut prendre : Strive lit le montant affiché sur l'offre,
    // donc ce qui revient au chauffeur, pas les 35–55 CHF/h de course brute
    // avant commission.
    thresholds: thresholdsFrom(0.92),
  },

  ES: {
    country: 'ES',
    currency: 'EUR',
    symbol: '€',
    distanceUnit: 'km',
    fuelKey: null,
    locales: ['es'],
    regimes: [
      // L'Espagne ne prélève PAS un pourcentage : le RETA est une cuota
      // forfaitaire mensuelle par tranche de rendements nets — de ~206 € à
      // ~607 € en 2026 (tables prorogées, MEI à 0,9 %). Un taux moyen inventé
      // ici serait faux pour presque tout le monde ; la cuota part donc dans
      // les charges fixes, que le chauffeur connaît exactement.
      { id: 'autonomo', rate: 0, base: 'profit', flatInFixedCosts: true },
      { id: 'company', rate: 0.45, base: 'profit' },
      { id: 'employee', rate: 0, base: 'revenue' },
    ],
    // ×0,64 → 16 €/h, 0,64 €/km. Madrid et Barcelone : 2 800–3 500 €/mois brut
    // sur 40 h, soit 16–20 €/h. En capitale de province moyenne c'est
    // 1 800–2 400 €/mois, donc bien moins — le plancher vise le bas de la
    // fourchette des grandes villes.
    thresholds: thresholdsFrom(0.64),
  },

  PT: {
    country: 'PT',
    currency: 'EUR',
    symbol: '€',
    distanceUnit: 'km',
    fuelKey: null,
    locales: ['pt'],
    regimes: [
      // 21,4 % appliqués à une base d'incidence de 70 % du chiffre d'affaires
      // (prestation de services, RCTI 2026) : 0,214 × 0,70 = 14,98 % du CA. La
      // base légale est réduite, pas les recettes — donc `revenue`, comme le
      // micro-BIC français, et non `profit`.
      { id: 'independent', rate: 0.1498, base: 'revenue' },
      { id: 'company', rate: 0.45, base: 'profit' },
      { id: 'employee', rate: 0, base: 'revenue' },
    ],
    // ×0,4 → 10 €/h, 0,40 €/km. 1 500–2 500 €/mois à temps plein (TVDE)
    // ≈ 9–14,50 €/h. C'EST LE MARCHÉ QUI JUSTIFIE LES MULTIPLES : appliquer la
    // base française telle quelle ici ferait refuser à peu près toutes les
    // courses du pays — l'app ne serait pas imprécise, elle serait inutilisable.
    thresholds: thresholdsFrom(0.4),
  },

  GB: {
    country: 'GB',
    currency: 'GBP',
    symbol: '£',
    distanceUnit: 'mi',
    fuelKey: null,
    locales: ['en'],
    regimes: [
      // National Insurance Class 4 : 6 % du bénéfice entre 12 570 £ et
      // 50 270 £, 2 % au-delà (2026/27). On retient 6 % — le taux MARGINAL du
      // chauffeur à plein temps, et c'est bien une décision marginale que
      // l'app arbitre : « cette course-ci vaut-elle le coup ». L'income tax
      // (20 % au-delà de l'abattement) reste hors périmètre, comme en France.
      { id: 'sole_trader', rate: 0.06, base: 'profit' },
      { id: 'company', rate: 0.45, base: 'profit' },
      { id: 'employee', rate: 0, base: 'revenue' },
    ],
    // ×0,64 → 16 £/h et 0,64 £/km — soit 1,03 £ par mile une fois affiché.
    // Médiane à £19/h brut (étude Oxford),
    // fourchette £15–25 — £18–25 à Londres ; après carburant, assurance, véhicule
    // et licence il reste £11–17/h. Le plancher se pose là où la course cesse de
    // payer le siège.
    thresholds: thresholdsFrom(0.64),
  },
};

/**
 * Nom de chaque langue DANS cette langue.
 *
 * Une liste de langues ne se traduit pas : un chauffeur qui cherche le
 * néerlandais cherche « Nederlands », pas « Néerlandais ». C'est la seule
 * étiquette de l'app qui reste identique quelle que soit la langue courante.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
  de: 'Deutsch',
  it: 'Italiano',
};

/**
 * Langues qui écrivent les décimales avec une VIRGULE.
 *
 * L'anglais est le seul des sept à utiliser le point. Tant qu'il n'y avait que
 * le français et l'anglais, un `language === 'fr' ? ',' : '.'` disait vrai ;
 * avec l'espagnol, le portugais, le néerlandais, l'allemand et l'italien il
 * devient faux cinq fois sur sept, et un chauffeur madrilène lisait « 1.5 € ».
 *
 * C'est une affaire de LANGUE et non de marché : un Espagnol écrit 1,5 qu'il
 * roule à Madrid ou à Londres.
 */
const DECIMAL_COMMA_LANGUAGES = ['fr', 'es', 'pt', 'nl', 'de', 'it'];

/** « , » ou « . », selon la langue affichée. */
export function decimalSeparator(language: string | undefined): string {
  const base = (language ?? 'en').split('-')[0];
  return DECIMAL_COMMA_LANGUAGES.includes(base) ? ',' : '.';
}

/** Code ISO de la devise, pour l'afficher à côté du symbole (« € EUR »). */
export const CURRENCY_CODE: Record<Currency, string> = {
  EUR: 'EUR',
  CHF: 'CHF',
  GBP: 'GBP',
};

/** Marché de repli quand la région est inconnue ou non couverte. */
export const DEFAULT_COUNTRY: CountryCode = 'FR';

const SUPPORTED_COUNTRIES = Object.keys(MARKETS) as CountryCode[];

export function isSupportedCountry(code: string | null | undefined): code is CountryCode {
  return !!code && (SUPPORTED_COUNTRIES as string[]).includes(code.toUpperCase());
}

/**
 * Région de l'appareil, en ISO 3166-1 alpha-2.
 *
 * `resolvedOptions()` expose `region` sur Hermes récent, mais pas partout : le
 * repli relit la région dans l'étiquette de locale (« fr-BE » → « BE »), qui,
 * elle, est toujours là. Une locale sans région (« fr » seul, fréquent sur
 * Android) ne dit rien du pays : on renvoie `null` plutôt que de deviner.
 */
export function detectCountry(): CountryCode | null {
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions() as { locale?: string; region?: string };
    const fromRegion = opts.region;
    if (isSupportedCountry(fromRegion)) return fromRegion.toUpperCase() as CountryCode;

    const parts = (opts.locale ?? '').split(/[-_]/);
    // « zh-Hans-CN » : la région est le dernier segment de deux lettres.
    const region = parts.reverse().find(p => /^[A-Za-z]{2}$/.test(p) && p === p.toUpperCase());
    if (isSupportedCountry(region)) return region!.toUpperCase() as CountryCode;
    return null;
  } catch {
    return null;
  }
}

/**
 * Le marché correspondant à une DEVISE, quand c'est tout ce que le chauffeur a
 * dit.
 *
 * Une devise ne désigne pas toujours un pays : le franc et la livre, oui, mais
 * l'euro en couvre quatre. Or un euro est un euro — l'affichage, l'unité de
 * distance et le prix du carburant saisi à la main sont identiques dans les
 * quatre. Il ne reste que le PLANCHER DE RENTABILITÉ, qui va de 25 €/h en France
 * à 10 €/h au Portugal, et qu'on ne peut pas demander sans reposer la question
 * du pays.
 *
 * On le déduit donc, dans cet ordre :
 *   1. la région de l'appareil, si elle désigne un pays de cette devise ;
 *   2. la langue choisie, quand elle n'en désigne qu'un (pt → PT, es → ES,
 *      nl → BE) — le français en couvre trois, il ne tranche rien ;
 *   3. le premier marché de la devise, faute de mieux.
 *
 * Et si la déduction tombe à côté, rien n'est perdu : le régime de cotisations
 * est demandé explicitement à l'onboarding, et le plancher se corrige d'un
 * curseur dans Préférences.
 */
const LANGUAGE_TO_COUNTRY: Record<string, CountryCode> = {
  pt: 'PT',
  es: 'ES',
  nl: 'BE',
  de: 'CH',
  it: 'CH',
  en: 'GB',
};

export function countryForCurrency(currency: Currency, language?: string): CountryCode {
  const candidates = (Object.keys(MARKETS) as CountryCode[]).filter(
    c => MARKETS[c].currency === currency,
  );
  if (candidates.length === 1) return candidates[0];

  const region = detectCountry();
  if (region && candidates.includes(region)) return region;

  const byLanguage = LANGUAGE_TO_COUNTRY[(language ?? '').split('-')[0]];
  if (byLanguage && candidates.includes(byLanguage)) return byLanguage;

  return candidates[0];
}

/**
 * Le marché à appliquer : le choix explicite du chauffeur d'abord, la région de
 * l'appareil ensuite, la France en dernier recours.
 */
export function getMarket(stored?: string | null): Market {
  if (isSupportedCountry(stored)) return MARKETS[stored.toUpperCase() as CountryCode];
  return MARKETS[detectCountry() ?? DEFAULT_COUNTRY];
}

/**
 * Montant dans la devise du marché.
 *
 * Remplace `formatEuros` et les « € » collés aux gabarits. Les milliers sont
 * séparés à la main : `toLocaleString` dépend d'un Intl dont la présence varie
 * selon la build Hermes, et un montant entier ne justifie pas ce pari.
 *
 * La livre se pose AVANT le nombre (« £24 »), l'euro et le franc après — s'y
 * tromper suffit à faire lire le prix comme une traduction automatique.
 */
export function formatMoney(
  amount: number,
  market: Market,
  {
    decimals = 0,
    language,
  }: { decimals?: number; language?: string } = {},
): string {
  const n = decimals > 0 ? amount.toFixed(decimals) : String(Math.round(amount));
  const [int, dec] = n.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  // La décimale suit la LANGUE, le symbole suit le MARCHÉ : un chauffeur
  // londonien qui lit l'app en espagnol veut « £14,50 », pas « £14.50 ».
  const body = dec ? `${grouped}${decimalSeparator(language ?? i18n.language)}${dec}` : grouped;
  return market.currency === 'GBP' ? `${market.symbol}${body}` : `${body} ${market.symbol}`;
}

/** Suffixe des seuils : « €/h », « £/h », « CHF/h ». */
export const hourlyUnit = (market: Market) => `${market.symbol}/h`;

/** « €/km » ou « £/mi », selon ce que le chauffeur a sous les yeux. */
export const distanceUnitLabel = (market: Market) =>
  `${market.symbol}/${market.distanceUnit}`;

/**
 * Distance lue par le scanner, ramenée à l'unité du marché.
 *
 * Les parsers rendent des kilomètres parce que c'est ce que les plateformes
 * affichent partout sauf au Royaume-Uni. Là-bas ils liront des miles, et il n'y
 * a rien à convertir : c'est l'unité de référence du marché.
 */
export function toMarketDistance(km: number, market: Market): number {
  return market.distanceUnit === 'mi' ? km / KM_PER_MILE : km;
}

/**
 * Taux « par kilomètre » ramené à l'unité du marché.
 *
 * `rides.km_rate` vaut toujours tarif ÷ kilomètres, sur les six marchés, et les
 * seuils se comparent à cette valeur-là. Mais un chauffeur britannique compte en
 * miles : 0,80 £/km, c'est 1,29 £/mile, et c'est le second chiffre qu'il
 * reconnaît. La conversion est donc un pur geste d'affichage — elle ne doit
 * JAMAIS entrer dans une comparaison, sous peine de décaler la barre de 1,6×.
 *
 * Un taux par mile est PLUS GRAND que le même taux par kilomètre : on parcourt
 * plus de chemin pour le gagner. D'où la multiplication, là où une distance,
 * elle, se divise.
 */
export function toMarketRate(ratePerKm: number, market: Market): number {
  return market.distanceUnit === 'mi' ? ratePerKm * KM_PER_MILE : ratePerKm;
}

/**
 * Le chemin inverse : ce que le chauffeur règle dans SON unité, ramené au
 * kilomètre pour être stocké et comparé.
 *
 * `preferences.min_km_rate` porte des kilomètres sur les six marchés — le
 * scanner, la bulle et le verdict natif en dépendent. Un curseur gradué en
 * miles doit donc redescendre ici avant d'être enregistré, sinon la barre
 * monte de 1,6× sans que personne ne l'ait demandé.
 */
export function fromMarketRate(rate: number, market: Market): number {
  return market.distanceUnit === 'mi' ? rate / KM_PER_MILE : rate;
}

/**
 * Le gallon IMPÉRIAL, 4,546 L — pas le gallon américain de 3,785 L.
 *
 * Les deux s'écrivent « mpg » et se confondent d'autant plus facilement que le
 * chiffre américain est 20 % plus petit pour la même voiture. Se tromper de
 * gallon ferait sous-estimer d'un cinquième le coût carburant de chaque course,
 * et le bénéfice net affiché serait systématiquement trop beau.
 */
export const LITRES_PER_IMPERIAL_GALLON = 4.54609;

/**
 * Le pont entre « litres aux 100 km » et « miles au gallon ».
 *
 * Les deux unités sont l'INVERSE l'une de l'autre : l'une compte le carburant
 * pour une distance fixe, l'autre la distance pour un carburant fixe. La
 * conversion est donc une division, dans les deux sens — `mpg = 282,48 / (L/100
 * km)` autant que `L/100 km = 282,48 / mpg`. Une multiplication, ici, donnerait
 * un chiffre qui a l'air plausible et qui est faux.
 *
 * 282,48 = (100 km ÷ 1,609 km par mile) × 4,546 L par gallon.
 */
export const MPG_FACTOR = (100 / KM_PER_MILE) * LITRES_PER_IMPERIAL_GALLON;

/**
 * Même inversion pour l'électrique : le Royaume-Uni compte en MILES PAR kWh
 * quand le continent compte en kWh aux 100 km.
 *
 * 62,14 = 100 km ÷ 1,609 km par mile.
 */
export const MI_PER_KWH_FACTOR = 100 / KM_PER_MILE;

/** « L/100km », « kWh/100km », ou « mpg » / « mi/kWh » au Royaume-Uni. */
export function consumptionUnit(market: Market, electric: boolean): string {
  if (market.distanceUnit === 'mi') return electric ? 'mi/kWh' : 'mpg';
  return electric ? 'kWh/100km' : 'L/100km';
}

/**
 * Bornes de saisie, dans l'unité que le chauffeur a sous les yeux.
 *
 * Écrites à la main et non déduites des bornes métriques : l'inversion rend
 * l'intervalle absurde dès qu'on le traduit mécaniquement (0,1 L/100 km
 * deviendrait 2 825 mpg, et une faute de frappe à 450 passerait). Chaque
 * fenêtre couvre largement le parc réel et rien au-delà :
 *
 *   5–200 mpg     → 56,5 à 1,4 L/100 km   (du 4×4 à l'hybride rechargeable)
 *   0,7–20 mi/kWh  → 88,8 à 3,1 kWh/100 km (du van électrique au deux-roues)
 *
 * Toutes retombent à l'intérieur des bornes métriques : la valeur enregistrée
 * reste valide quelle que soit la porte d'entrée.
 */
export function consumptionBounds(
  market: Market,
  electric: boolean,
): { min: number; max: number; unit: string } {
  const unit = consumptionUnit(market, electric);
  if (market.distanceUnit === 'mi') {
    return electric ? { min: 0.7, max: 20, unit } : { min: 5, max: 200, unit };
  }
  return { min: 0.1, max: 99.9, unit };
}

/**
 * Consommation stockée (toujours aux 100 km) → unité du marché.
 *
 * `profiles.avg_cons` reste métrique sur les six marchés, comme
 * `rides.distance_km` : c'est ce qui entre dans `computeFuelCost`, et le coût
 * carburant d'une course se calcule sur des kilomètres et des litres. Le mpg
 * n'existe qu'entre le champ de saisie et l'œil du chauffeur.
 */
export function toMarketConsumption(
  per100km: number,
  market: Market,
  electric: boolean,
): number {
  if (market.distanceUnit !== 'mi' || !(per100km > 0)) return per100km;
  return (electric ? MI_PER_KWH_FACTOR : MPG_FACTOR) / per100km;
}

/** Le chemin inverse, pour ce que le chauffeur tape. */
export function fromMarketConsumption(
  value: number,
  market: Market,
  electric: boolean,
): number {
  if (market.distanceUnit !== 'mi' || !(value > 0)) return value;
  return (electric ? MI_PER_KWH_FACTOR : MPG_FACTOR) / value;
}
