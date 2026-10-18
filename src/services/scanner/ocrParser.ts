/**
 * Parsing sémantique partagé Android + iOS.
 *
 * Android : ML Kit extrait les TextBlocks → les envoie ici via bridge
 * iOS     : Vision framework extrait les TextBlocks → les envoie ici via bridge
 *
 * La logique de parsing ne vit qu'ici — un seul endroit à maintenir.
 */

import { ScanResult, ScanPlatform, TextBlock } from './types';

// ─── Remote config (patchable via Supabase sans republier) ───────────────────

const PRICE_ANCHORS: Record<ScanPlatform, string[]> = {
  UBER:    ['total', 'fare', 'trip fare', 'estimated fare', 'net'],
  BOLT:    ['gain', 'earning', 'revenu', 'estimé', 'net'],
  HEETCH:  ['course', 'tarif', 'prix', 'net'],
  UNKNOWN: ['total', 'gain', 'fare', 'tarif', 'net'],
};

// Tournures propres à une plateforme — secours quand la marque n'est pas
// capturée (ex: Uber dark mode "Share · Exclusivité · Montant net de frais"
// SANS "Uber"). Mirror exact des parsers natifs. FR + EN.
const UBER_PHRASES = ['exclusivité', 'exclusivite', 'montant net', 'net de frais', 'exclusive', 'net fare', 'net earnings'];
const HEETCH_PHRASES = ['proposer', '€ brut', 'propose', 'gross'];
const BOLT_PHRASES = ['net, ttc', 'net,ttc', 'incl. vat', 'net, incl'];
// Catégories de course propres à une seule plateforme (mot entier).
const UBER_ONLY_MODES = ['uberx', 'uberxl', 'uberpool', 'berline', 'comfort electric', 'share'];
const BOLT_ONLY_MODES = ['bolt xl', 'bolt comfort', 'bolt premium', 'bolt plus'];

// Tolère les espaces internes autour du séparateur : "17 , 18 €" ou "11 . 8 km"
/**
 * Symboles monétaires reconnus à l'écran.
 *
 * `PRICE_REGEX` n'exige aucun symbole — un montant décimal suffit — mais deux
 * REPLIS en réclamaient un, et il était écrit « € » : sur une offre londonienne
 * (« £16.40 ») ou genevoise (« CHF 24.50 »), ces replis ne mordaient jamais. Ils
 * ne servent que quand l'OCR a perdu la virgule, donc la panne était
 * intermittente — le pire mode de défaillance à diagnostiquer.
 */
const CURRENCY_REGEX = /€|£|CHF/i;

// Écrit en littéral, et pas construit par `new RegExp` à partir d'un morceau
// partagé : dans un gabarit, `\d` n'est pas une séquence d'échappement connue et
// se réduit à `d`. L'expression devenait `(d{2,6}|...)`, cinq fixtures tombaient.

const PRICE_REGEX    = /(\d{1,3})\s*[.,]\s*(\d{2})(?!\d)/;
const DISTANCE_REGEX = /(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km/i;
const DURATION_REGEX = /(\d{1,3})\s*min/i;
// Contexte véhicule électrique. Uber affiche sur certaines offres une info de
// recharge ou d'autonomie ("35 min", "250 km") qui n'a rien à voir avec la
// course : sans ce filtre elle devient la durée ou la distance, et le €/h comme
// le €/km sont faux — sans que rien ne signale l'erreur.
//
// ⚠️ « charge » seul est PROSCRIT : « prise en charge » désigne le pickup et
// apparaît sur presque toutes les offres. On ne matche que « recharge ».
const EV_CONTEXT_REGEX =
  /(autonomie|autonom[ií]a|autonomia|reichweite|actieradius|recharg|ricarica|carregar|cargando|opladen|laden|borne\s|batterie|bater[ií]a|bateria|batterij|batteria|akku|électrique|electrique|el[ée]ctrico|el[ée]trico|elettrico|elektrisch|kwh|\bev\b|charging|battery|\brange\b)/i;
// Ligne combinée pickup : "4 min • 1,2 km" ou "1,2 km • 4 min" avec séparateurs variés (•·-–—:, espaces)
//
// Le séparateur admet des LETTRES. Il excluait auparavant [a-zà-ü], ce qui
// écartait le format que l'app Uber FR utilise réellement : "11 min (à 2,6 km)".
// Le « à » suffisait à faire échouer le match — l'approche n'était donc JAMAIS
// reconnue sur une offre Uber française, et ses km/min ne rentraient pas dans
// le total. Voir fixtures/ocr/core.json#uber-approach-longer-than-ride.
// La borne à 8 caractères garde le pont court : elle couvre " (à ", " · ",
// " away (" — pas " Course de ", qui relierait deux lignes distinctes.
const PICKUP_COMBO_MIN_FIRST = /(\d{1,3})\s*min[^0-9]{0,8}(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km/i;
const PICKUP_COMBO_KM_FIRST  = /(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km[^0-9]{0,8}(\d{1,3})\s*min/i;

// Mots-clés de type voie — FR + EN — pour détecter les adresses
// Mots de voie à matcher comme MOT ENTIER (FR, EN, ES, IT, NL, PT) + POIs
const ADDRESS_STREET_KEYWORDS = [
  // FR
  'rue', 'avenue', 'av.', 'boulevard', 'blvd', 'bd', 'bd.',
  'place', 'pl.', 'impasse', 'imp.', 'allée', 'allee', 'all.',
  'chemin', 'ch.', 'route', 'rte', 'rte.', 'passage',
  'quai', 'villa', 'cité', 'cite', 'esplanade', 'cours',
  'faubourg', 'fg.', 'voie', 'sq.', 'square',
  // EN / UK. Les cinq premiers suffisaient pour une adresse britannique
  // « de manuel » ; les suivants sont ce que porte réellement le tissu urbain
  // anglais, où « Close », « Crescent » et « Gardens » sont aussi courants que
  // « Street ». Sans eux, « 14 Elmwood Gardens » ne passait que par la structure
  // chiffre-d'abord, et une adresse sans numéro ne passait pas du tout.
  'street', 'road', 'lane', 'drive', 'st.', 'rd.', 'ave.', 'way',
  'crescent', 'terrace', 'gardens', 'mews', 'row',
  'walk', 'grove', 'hill', 'rise', 'wharf', 'embankment',
  // ES — « c/ » est l'abréviation ordinaire de « calle » sur les plaques comme
  // dans les applis ; sans elle, la moitié des adresses espagnoles ne portent
  // aucun mot de voie reconnaissable.
  'calle', 'c/', 'avenida', 'avda', 'plaza', 'paseo', 'carretera', 'camino', 'ronda',
  // IT
  'via', 'viale', 'corso', 'piazza', 'strada', 'vicolo', 'largo',
  // NL
  'straat', 'laan', 'plein', 'gracht',
  // PT
  'travessa', 'rua', 'praça', 'praca', 'estrada', 'alameda',
  // POIs FR/EN + traductions EU
  'gare', 'aéroport', 'aeroport', 'airport', 'terminal',
  'porte', 'hôpital', 'hopital', 'hospital', 'station',
  'bahnhof', 'hauptbahnhof', 'flughafen', 'krankenhaus',
  'estación', 'estacion', 'aeropuerto',
  'stazione', 'aeroporto', 'ospedale',
];
// Suffixes DE qui forment des mots composés (Hauptstraße). Matchés en fin de mot.
/**
 * Types de voie anglais qui sont AUSSI des mots français.
 *
 * « court » (trajet court), « park », « close », « green » : quatre mots que
 * l'app rencontre en France, et qui y feraient passer un bloc quelconque pour
 * une adresse — au risque d'évincer la vraie. Ils ne sont consultés que sur le
 * marché britannique, où ils désignent bel et bien des rues.
 */
const UK_ONLY_STREET_KEYWORDS = ['close', 'court', 'park', 'green'];

/**
 * Marché du scan en cours, posé par `parseBlocks`.
 *
 * Une variable de module plutôt qu'un paramètre traversant six fonctions : le
 * parser est synchrone et ne traite qu'une capture à la fois, et les fonctions
 * qu'il faudrait sinon modifier sont réglées au cas par cas sur des captures
 * réelles. Mirror du `marketCountry` statique des parsers natifs.
 */
let scanCountry = 'FR';

const ADDRESS_STREET_SUFFIXES = [
  'straße', 'strasse', 'str.', 'gasse', 'weg', 'allee', 'platz',
  'damm', 'ufer', 'ring',
];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Code postal : signal fort d'adresse, et sans ambiguïté.
 *
 * Le motif était purement numérique (4 à 5 chiffres) — parfait pour 75011,
 * 1000 Bruxelles ou 1200-001 Lisbonne, aveugle au Royaume-Uni où le code postal
 * est alphanumérique (« SW1A 1AA », « M1 1AE », « B33 8TH »). Les adresses
 * londoniennes perdaient donc leur signal le plus fiable : elles se faisaient
 * évincer dès qu'elles tombaient loin d'un bloc km/min à l'écran.
 */
const POSTCODE_REGEX = /\b\d{4,5}\b|\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i;

/**
 * Code postal SORTANT seul, suivi d'une ville : « TW6, Hounslow », « CV1,
 * Coventry ». C'est la forme qu'Uber affiche au Royaume-Uni — jamais le code
 * complet.
 *
 * ── POURQUOI LA VIRGULE EST OBLIGATOIRE ───────────────────────────────────
 * « E05 », « A421 », « M1 » : la carte affichée derrière la carte d'offre est
 * couverte de numéros de route qui ont exactement la forme d'un code sortant.
 * Exiger « code, ville » les écarte tous, et c'est de toute façon la seule
 * forme qui nous intéresse : un code nu ne géocode pas mieux qu'une route.
 */
const UK_OUTWARD_REGEX = /\b[a-z]{1,2}\d[a-z\d]?\s*,\s*[a-z]/i;

/**
 * MILES → KILOMÈTRES, avant toute autre lecture.
 *
 * Les plateformes affichent des miles au Royaume-Uni. Toutes les expressions de
 * ce parser sont ancrées sur « km » : un écran londonien ne rendait donc AUCUNE
 * distance, et `parseBlocks` sortait sur `distanceKm === null` — pas de verdict
 * du tout, alors que le prix, lui, avait été lu.
 *
 * On réécrit le texte plutôt que d'ajouter une unité à chaque expression. Ces
 * expressions sont réglées au cas par cas sur des captures d'écran réelles, avec
 * leurs indices de groupe et leurs gardes contre les faux positifs ; y toucher
 * pour une unité coûterait bien plus cher que ce que ça règle. Et le reste de la
 * chaîne — `RATE_MIN`, `isSane`, la colonne `rides.distance_km` —
 * raisonne en kilomètres : c'est à l'ENTRÉE qu'il faut convertir, pas à la
 * sortie. Le mile ne revient qu'à l'affichage, via `market.distanceUnit`.
 *
 * « min » n'est pas touché : `(?![a-z])` empêche « mi » de mordre dessus.
 */
const MILES_REGEX = /(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*(?:miles?|mi)(?![a-zà-ü-])/gi;

export const milesToKm = (text: string): string =>
  text.replace(MILES_REGEX, (_m, raw: string) => {
    const value = parseFloat(raw.replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(value)) return _m;
    // Une décimale : c'est la précision qu'affichent les plateformes, et les
    // expressions en aval n'en acceptent pas plus de deux.
    return `${(value * 1.609344).toFixed(1)} km`;
  });

// Helper : nettoie espaces internes autour du séparateur décimal avant parseFloat
const cleanNum = (raw: string) => raw.replace(/\s+/g, '').replace(',', '.');

/**
 * Corrige les confusions OCR chiffre↔lettre UNIQUEMENT en contexte numérique
 * (entre deux chiffres, ou entre chiffre et séparateur décimal). Cas réel :
 * "1l.8 km" (ML Kit lit le 1 comme un L minuscule). Safe pour les adresses.
 */
const normalizeOcrDigits = (s: string) =>
  s
    // Runs l/I avant ".X" ou avant un nombre décimal "X.Y"
    .replace(/(?<![a-zA-Zà-ü])[lI]+(?=[.,]\d)/g, m => '1'.repeat(m.length))
    .replace(/(?<![a-zA-Zà-ü])[lI]+(?=\d[.,]\d)/g, m => '1'.repeat(m.length))
    // Runs l/I après "X." (partie décimale)
    .replace(/(?<=\d[.,])[lI]+(?![a-zA-Zà-ü])/g, m => '1'.repeat(m.length))
    // Lettre isolée entre chiffres
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
    // Idem O/o
    .replace(/(?<![a-zA-Zà-ü])[oO]+(?=[.,]\d)/g, m => '0'.repeat(m.length))
    .replace(/(?<![a-zA-Zà-ü])[oO]+(?=\d[.,]\d)/g, m => '0'.repeat(m.length))
    .replace(/(?<=\d[.,])[oO]+(?![a-zA-Zà-ü])/g, m => '0'.repeat(m.length))
    .replace(/(?<=\d)[oO](?=\d)/g, '0');

// Mots à exclure des candidats adresse
const NON_ADDRESS_WORDS = [
  // FR / EN
  'uber', 'bolt', 'heetch', 'total', 'fare', 'gain', 'tarif',
  'accepted', 'accepté', 'min', 'km', 'estimated', 'estimé',
  // ES / PT / IT / NL / DE — les libellés de BOUTON des autres marchés. Sans
  // eux, un « Aceptar » ou un « Annehmen » seul sur sa ligne pouvait être pris
  // pour une adresse, et évincer la vraie.
  'aceptar', 'aceptado', 'estimado', 'tarifa', 'ganancia',
  'aceitar', 'aceite', 'ganho',
  'accetta', 'accettata', 'stimato', 'tariffa', 'guadagno',
  'aanvaarden', 'aanvaard', 'geschat', 'tarief', 'inkomsten',
  'annehmen', 'angenommen', 'geschätzt', 'geschaetzt', 'einnahmen',
];

// ─── Sanity bounds ────────────────────────────────────────────────────────────

const FARE_MIN = 8;
/** Heetch seulement : sa course minimum rapporte 7,50 € net (10 € brut moins
 *  25 %), et c'est le net que Strive retient. Uber et Bolt gardent FARE_MIN.
 *  Mirror Swift/Kotlin. */
const HEETCH_FARE_MIN = 7;

function fareMinFor(platform: ScanPlatform): number {
  return platform === 'HEETCH' ? HEETCH_FARE_MIN : FARE_MIN;
}
/** Plafond d'un montant SANS décimales : au-delà, c'est une virgule perdue par
 *  l'OCR (« 1743€ » = 17,43 €), pas une course à 1 743 €. */
const FARE_MAX = 200;
/** Plafond d'un montant écrit AVEC ses décimales. Ce n'était que FARE_MAX, et
 *  toute course longue mourait au parse : 272,30 € pour Lisses → Lyon. Ici rien
 *  n'est à reconstruire. */
const FARE_CEILING = 2000;
const DIST_MIN = 0.3;
/** 500 km bloquait Paris → Marseille (775 km). Large exprès : c'est le plancher
 *  €/km de `isSane` qui juge une distance aberrante. Mirror Swift/Kotlin. */
const DIST_MAX = 2000;
/** Plancher seulement, pas de plafond : le prix d'une plateforme est réel, et
 *  une course Van/XL courte dépasse sans peine 12 €/km (12,79 € pour 1 km,
 *  31,34 € pour 1,6 km). L'ancien plafond à 12 a rejeté 35 offres d'un même
 *  chauffeur les 15-16/10/2026 sans écarter une seule erreur de lecture. */
const RATE_MIN = 0.4;  // €/km
/** Haut d'écran jamais lu : barre d'état, bannières de notification (celle
 *  d'Uber qui répète le prix, le verdict de Strive lui-même, la Live
 *  Activity). Sur les captures réelles, ces bannières finissent avant 17 % de
 *  la hauteur et les offres commencent après 35 %. Même bande que la « zone
 *  prix/header » des adresses. Mirror Swift/Kotlin. */
const TOP_CUT = 0.25;

// ─── Entry point ──────────────────────────────────────────────────────────────

export function parseBlocks(
  blocks: TextBlock[],
  screenHeight: number,
  /**
   * Pays d'activité du chauffeur. Il n'entre en jeu QUE pour ce qui serait faux
   * en France — la conversion des miles et les quatre types de voie anglais qui
   * sont aussi des mots français. Par défaut `FR`, soit le comportement
   * d'origine au caractère près.
   */
  country: string = 'FR',
): ScanResult | null {
  if (blocks.length === 0) return null;
  scanCountry = country;

  // Strive se lisait lui-même : sa notification de verdict, restée à l'écran,
  // devenait une fausse offre au scan suivant (scan_debug #110).
  blocks = blocks.filter(b => b.y + b.height / 2 >= screenHeight * TOP_CUT);

  // Conversion des miles AVANT tout le reste : ce qui suit ne connaît que le km.
  //
  // ⚠️ UNIQUEMENT AU ROYAUME-UNI. ML Kit découpe parfois « 11 min » en deux
  // blocs, et « 11 mi » seul serait alors lu comme 17,7 km : une distance 1,6×
  // trop grande, donc un €/km faux, et rien pour le signaler. Le seul marché
  // qui affiche des miles est le seul où l'on prend ce risque.
  if (country === 'GB') {
    blocks = blocks.map(b => (/mi/i.test(b.text) ? { ...b, text: milesToKm(b.text) } : b));
  }

  const fullText = blocks.map(b => b.text).join(' ').toLowerCase();
  const platform = detectPlatform(fullText);

  const fareHit = extractFare(blocks, platform, screenHeight);
  if (fareHit === null) return null;
  const fare = fareHit.value;
  // La zone des adresses part du bloc de prix RETENU. Le chercher à nouveau par
  // son texte prenait la première occurrence du montant — un bandeau ou l'overlay
  // d'une autre app tout en haut — et écartait les deux vraies adresses.
  const fareBlockY = fareHit.block.y + fareHit.block.height / 2;
  const fareInButton = ACCEPT_REGEX.test(fareHit.block.text);

  // Invariant layout VTC : la pickup est toujours la 1ʳᵉ adresse (Y le + haut),
  // la destination la 2ᵉ. On s'en sert pour catégoriser les km/min ambigus.
  const addressBlocks = findAddressBlocks(blocks, screenHeight, fareBlockY, fareInButton);
  const pickupAddrBlock = addressBlocks[0];
  const destAddrBlock = addressBlocks[1];

  const distanceKm = extractDistance(blocks, pickupAddrBlock, destAddrBlock);
  if (distanceKm === null) return null;

  if (!isSane(fare, distanceKm, platform)) return null;

  const pickup = extractPickupInfo(blocks, distanceKm, screenHeight);

  return {
    platform,
    fare,
    distanceKm,
    durationMin: extractDuration(blocks, pickupAddrBlock, destAddrBlock, distanceKm),
    pickupAddress:     pickupAddrBlock ? mergeAddressContinuation(pickupAddrBlock, blocks) : undefined,
    destinationAddress: destAddrBlock ? mergeAddressContinuation(destAddrBlock, blocks) : undefined,
    pickupDurationMin: pickup?.durationMin,
    pickupDistanceKm:  pickup?.distanceKm,
  };
}

/**
 * Ré-unifie une adresse splittée par l'OCR. Cherche un bloc juste en-dessous
 * aligné horizontalement, court, non-stats, non-adresse, et concatène.
 * "1 Allee Des Bordes, Chennevières-sur-" + "Marne, 94430" → une seule adresse.
 */
function mergeAddressContinuation(addrBlock: TextBlock, allBlocks: TextBlock[]): string {
  const baseText = addrBlock.text.trim();
  const continuation = allBlocks.find(
    other => other !== addrBlock && isContinuationLine(addrBlock, other, allBlocks),
  );

  const merged = !continuation
    ? baseText
    : baseText.endsWith('-')
      ? `${baseText}${continuation.text.trim()}`
      : `${baseText}\n${continuation.text.trim()}`;

  return withUkOutwardPrefix(merged, addrBlock, allBlocks);
}

/**
 * Recolle devant l'adresse le « TW6, Hounslow » qui la précède à l'écran.
 *
 * `collapseUkOutwardPairs` a écarté ce bloc des candidats pour qu'il ne décale
 * pas le couple départ/arrivée ; il reste dans les blocs bruts, et c'est ici
 * qu'il reprend sa place.
 *
 * ── POURQUOI ON GARDE LES DEUX LIGNES ─────────────────────────────────────
 * Choisir aurait coûté quelque chose dans les deux sens. C'est l'en-tête qui
 * GÉOCODE : « Terminal 3, Level 3, Row A » ne désigne aucun point sur Terre
 * sans sa ville, TomTom rendait un échec, et la course retombait sur un
 * itinéraire estimé — donc sans le trafic réel, qui est la raison d'être de
 * l'app. Mais c'est la ligne de détail que le chauffeur lit pour trouver son
 * client dans un parking d'aéroport. Les deux disent le même endroit, elles
 * n'ont aucune raison de s'exclure.
 */
function withUkOutwardPrefix(
  merged: string,
  addrBlock: TextBlock,
  allBlocks: TextBlock[],
): string {
  if (scanCountry !== 'GB') return merged;
  if (UK_OUTWARD_REGEX.test(merged)) return merged;
  const addrRight = addrBlock.x + addrBlock.width;

  const above = allBlocks.find(other => {
    if (other === addrBlock) return false;
    const otherBottom = other.y + other.height;
    // Juste au-dessus, et collée : une ligne plus haute appartient à autre chose.
    if (otherBottom > addrBlock.y) return false;
    if (addrBlock.y - otherBottom > addrBlock.height * 1.5) return false;
    const xOverlap = Math.min(addrRight, other.x + other.width) - Math.max(addrBlock.x, other.x);
    if (xOverlap < Math.min(addrBlock.width, other.width) * 0.5) return false;
    const t = other.text.trim();
    return t.length <= 40 && UK_OUTWARD_REGEX.test(t);
  });

  return above ? `${above.text.trim()}, ${merged}` : merged;
}


// ─── Détection plateforme ─────────────────────────────────────────────────────

function containsWord(text: string, word: string): boolean {
  return new RegExp(`(?<![a-zà-üß0-9])${escapeRegex(word)}(?![a-zà-üß0-9])`, 'i').test(text);
}

function detectPlatform(fullText: string): ScanPlatform {
  // 1. Nom de marque explicite (signal fort).
  if (fullText.includes('heetch')) return 'HEETCH';
  if (fullText.includes('uber')) return 'UBER';
  if (fullText.includes('bolt')) return 'BOLT';
  // 2. Tournures propres à une plateforme (Uber dark mode sans "Uber", etc.).
  const uberP = UBER_PHRASES.some(p => fullText.includes(p));
  const heetchP = HEETCH_PHRASES.some(p => fullText.includes(p));
  const boltP = BOLT_PHRASES.some(p => fullText.includes(p));
  if (uberP && !heetchP && !boltP) return 'UBER';
  if (heetchP && !uberP && !boltP) return 'HEETCH';
  if (boltP && !uberP && !heetchP) return 'BOLT';
  // 3. Catégorie de course propre à une plateforme (mot entier).
  const uberHint = UBER_ONLY_MODES.some(m => containsWord(fullText, m));
  const boltHint = BOLT_ONLY_MODES.some(m => containsWord(fullText, m));
  if (uberHint && !boltHint) return 'UBER';
  if (boltHint && !uberHint) return 'BOLT';
  return 'UNKNOWN';
}

// ─── Extraction du prix — scoring sémantique ─────────────────────────────────

/** Bouton d'acceptation (« Accept €272,30 », « Accepter 12,30 € »…). Un prix
 *  écrit DANS ce bouton est celui que le chauffeur touche en acceptant ; les
 *  autres montants de l'écran sont des contre-propositions. */
const ACCEPT_REGEX = /accept|acept|accett|aceit|annehm|aanvaard/i;

function extractFare(
  blocks: TextBlock[],
  platform: ScanPlatform,
  screenHeight: number,
): { value: number; block: TextBlock } | null {
  const anchors = PRICE_ANCHORS[platform] ?? PRICE_ANCHORS.UNKNOWN;
  const fareMin = fareMinFor(platform);

  const candidates: { value: number; score: number; block: TextBlock }[] = [];

  blocks.forEach((block, idx) => {
    const normalizedText = normalizeOcrDigits(block.text);
    // Exclut les boutons de suggestion de prix Heetch ("Proposer X €")
    if (/proposer/i.test(normalizedText)) return;

    // Retire la note de l'app ("★ 5,00", "* 5,00") : un nombre précédé d'une
    // étoile n'est jamais un tarif. Évite que "5,00" l'emporte via l'ancre "net"
    // du libellé "Montant net de frais" collé juste à côté.
    const deRated = normalizedText.replace(/[★⭐✩✪✯*]\s*\d{1,2}\s*[.,]\s*\d{1,2}/g, ' ');

    let value: number | null = null;
    let ceiling = FARE_MAX;
    const match = PRICE_REGEX.exec(deRated);
    if (match) {
      value = parseFloat(`${match[1].replace(/\s+/g, '')}.${match[2].replace(/\s+/g, '')}`);
      ceiling = FARE_CEILING;
    } else {
      // Tarif "collé" à l'euro, virgule perdue par l'OCR ("17,43 €" → "1743€").
      // Les apps VTC affichent toujours 2 décimales : si l'entier dépasse le
      // plafond plausible, on réinterprète les 2 derniers chiffres en centimes.
      // Deux chiffres ou plus, OU un chiffre seul de 6 à 9 : une course à 9 €
      // existe (tarif minimum VTC), alors qu'un "5€" sec est presque toujours un
      // pourboire suggéré, un pack ou une note — cf. fixture canonique. La regex
      // reste plus large que le plancher FARE_MIN (8 €), qui écarte 6 et 7.
      const glued = /(\d{2,6}|[6-9])\s*(?:€|£|CHF)/i.exec(deRated);
      if (glued) {
        const raw = parseInt(glued[1], 10);
        value = raw > FARE_MAX ? raw / 100 : raw;
      }
    }
    if (value === null || value < fareMin || value > ceiling) return;

    let score = 0;

    // Taille du texte = indicateur visuel d'importance
    score += block.height * 1.5;

    // Zone haute de l'écran
    if (block.y < screenHeight * 0.55) score += 30;

    // Le bloc lui-même contient un ancre ("Total", "Gain"…)
    const lower = block.text.toLowerCase();
    if (anchors.some(a => lower.includes(a))) score += 25;

    // Bloc précédent contient un ancre
    if (idx > 0 && anchors.some(a => blocks[idx - 1].text.toLowerCase().includes(a))) score += 35;

    // Bloc suivant contient un ancre (cas Uber : label sous le montant)
    if (idx < blocks.length - 1 && anchors.some(a => blocks[idx + 1].text.toLowerCase().includes(a))) score += 20;

    // Le prix du bouton d'acceptation l'emporte sur les contre-propositions
    // (Heetch : « Accept €272,30 » face à €345,10 et €326,90, plus gros).
    if (ACCEPT_REGEX.test(block.text)) score += 60;

    candidates.push({ value, score, block });
  });

  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return { value: best.value, block: best.block };
}

/**
 * ML Kit fragmente parfois un nombre décimal en deux blocs autour du point.
 * Deux cas : ponctuation conservée ("Course de 11." + "8 km") ou point perdu
 * par l'OCR ("Course de 11" + "8 km"). On tente un recollage strict puis un
 * recollage permissif limité aux raw int à 1 chiffre pour éviter les faux
 * positifs — les combos pickup ("6 min • 8 km") sont déjà filtrés ailleurs.
 */
function tryStitchFragmentedDistance(
  blocks: TextBlock[],
  current: TextBlock,
  rawInt: string,
): number | null {
  const cleanedRaw = rawInt.replace(/\s+/g, '');

  for (const other of blocks) {
    if (other === current) continue;
    const rowTol = Math.max(other.height, current.height) * 1.5 || 30;
    if (Math.abs(other.y - current.y) > rowTol) continue;
    // À gauche du bloc courant (avec marge de 20px)
    if (other.x + other.width > current.x + 20) continue;

    // 1. Strict : le voisin finit par "NN." ou "NN,"
    const strictMatch = other.text.match(/(\d{1,3})\s*[.,]\s*$/);
    if (strictMatch) {
      const stitched = parseFloat(`${strictMatch[1]}.${cleanedRaw}`);
      if (Number.isFinite(stitched) && stitched >= DIST_MIN && stitched <= DIST_MAX) {
        return stitched;
      }
    }

    // 2. Permissif : le voisin finit par "NN" (point perdu par OCR).
    //    Réservé au raw 1 chiffre ("8 km") pour éviter les faux positifs.
    if (cleanedRaw.length === 1) {
      const looseMatch = other.text.match(/(\d{1,3})\s*$/);
      if (looseMatch) {
        const stitched = parseFloat(`${looseMatch[1]}.${cleanedRaw}`);
        if (Number.isFinite(stitched) && stitched >= DIST_MIN && stitched <= DIST_MAX) {
          return stitched;
        }
      }
    }
  }
  return null;
}

/**
 * Recollage intra-bloc : si l'OCR garde les deux chiffres dans le même bloc
 * mais a perdu le point, on cherche "X Y km" (séparateur uniquement whitespace)
 * dans le texte du bloc courant. "Course de 11 8 km" → 11.8.
 *
 * Contrainte : Y doit correspondre au rawInt déjà extrait par DISTANCE_REGEX —
 * évite de matcher du bruit loin dans le bloc. Les combos pickup ("min") sont
 * filtrés après coup via isPickupCombo, pas besoin de s'en soucier ici.
 */
function tryIntraBlockStitch(blockText: string, rawInt: string): number | null {
  const cleanedRaw = rawInt.replace(/\s+/g, '');
  const regex = /(\d{1,3})\s+(\d{1,2})\s*km/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(blockText)) !== null) {
    const a = m[1];
    const b = m[2].replace(/\s+/g, '');
    if (b !== cleanedRaw) continue;
    const stitched = parseFloat(`${a}.${b}`);
    if (Number.isFinite(stitched) && stitched >= DIST_MIN && stitched <= DIST_MAX) {
      return stitched;
    }
  }
  return null;
}

// ─── Extraction distance ──────────────────────────────────────────────────────

/**
 * Un écran d'offre VTC contient souvent 2 valeurs en km : la distance d'approche
 * (pickup — ligne combinée "X min • Y km") et la distance de la course.
 *
 * On utilise 2 signaux pour distinguer course vs pickup :
 *  1. Un bloc qui contient à la fois `min` et `km` est le combo pickup.
 *  2. Si on connaît les adresses : tout km dont le Y est **à/après la pickup
 *     address et avant/à la destination** est un candidat course fort.
 *     Les km AVANT la pickup address sont probablement pickup (le combo est
 *     souvent au-dessus ou à côté de l'adresse d'approche).
 */
function extractDistance(
  blocks: TextBlock[],
  pickupAddr?: TextBlock,
  destAddr?: TextBlock,
): number | null {
  const candidates: { value: number; isPickupCombo: boolean; y: number }[] = [];

  for (const block of blocks) {
    // Autonomie annoncée en km ("Autonomie 250 km") → ce n'est pas la course.
    if (EV_CONTEXT_REGEX.test(block.text)) continue;
    // Normalise les confusions OCR chiffre↔lettre (ex: "1l.8 km" → "11.8 km")
    // avant d'appliquer le regex de distance.
    const normalizedText = normalizeOcrDigits(block.text);
    const match = DISTANCE_REGEX.exec(normalizedText);
    if (!match) continue;
    const raw = match[1];
    let value = parseFloat(cleanNum(raw));
    if (!Number.isFinite(value)) continue;

    // Défense fragmentation ML Kit : "Course de 11.8 km" peut être découpé de
    // deux façons :
    //   a) Deux blocs côte à côte ("Course de 11." + "8 km") — stitch inter-bloc
    //   b) Un seul bloc avec le point perdu ("Course de 11 8 km") — stitch intra-bloc
    // On tente intra d'abord (plus sûr : contrainte du même bloc), puis inter.
    if (!raw.includes('.') && !raw.includes(',')) {
      const intra = tryIntraBlockStitch(normalizedText, raw);
      if (intra !== null) value = intra;
      else {
        const inter = tryStitchFragmentedDistance(blocks, block, raw);
        if (inter !== null) value = inter;
      }
    }

    if (value < DIST_MIN || value > DIST_MAX) continue;
    const isPickupCombo = /min/i.test(block.text);
    candidates.push({ value, isPickupCombo, y: block.y });
  }

  if (candidates.length === 0) return null;

  // 1. Zone course (entre pickup et destination) — si connue
  if (pickupAddr && destAddr) {
    const yMin = pickupAddr.y - 10;
    const yMax = destAddr.y + destAddr.height + 10;
    const inCourseZone = candidates.filter(
      c => !c.isPickupCombo && c.y >= yMin && c.y <= yMax,
    );
    if (inCourseZone.length > 0) {
      return inCourseZone.reduce((max, c) => (c.value > max ? c.value : max), 0);
    }
  }

  // 2. Fallback : exclure les combos pickup, prendre le plus grand
  const nonPickup = candidates.filter(c => !c.isPickupCombo);
  const pool = nonPickup.length > 0 ? nonPickup : candidates;
  return pool.reduce((max, c) => (c.value > max ? c.value : max), 0);
}

// ─── Extraction durée ─────────────────────────────────────────────────────────

/**
 * Comme pour la distance : un bloc mixte `min` + `km` est un combo pickup.
 * Si on a les positions d'adresses, on préfère une durée située dans la zone
 * course (entre pickup et destination). Sinon, on exclut juste les combos.
 * La durée course est rarement affichée sur les offres Uber FR → null est ok,
 * le JS estime ensuite via distance / 25 km/h.
 */
function extractDuration(
  blocks: TextBlock[],
  pickupAddr?: TextBlock,
  destAddr?: TextBlock,
  /**
   * Distance de la course, déjà extraite. Sert à reconnaître la ligne de
   * RÉSUMÉ parmi les lignes « N min (D km) » — voir ci-dessous.
   */
  courseDistanceKm?: number | null,
): number | null {
  const candidates: { value: number; y: number }[] = [];

  for (const block of blocks) {
    // Une ligne qui porte des km est, presque toujours, le bloc d'APPROCHE
    // (« 3 min (0.4 km) ») : ses minutes ne sont pas celles de la course, et
    // les prendre divisait le tarif par un temps dix fois trop court.
    //
    // L'exception est le résumé de course, qu'Uber écrit exactement dans la
    // même forme au Royaume-Uni : « 55 mins (26.9 mi) ». Là-bas la durée
    // n'existe NULLE PART ailleurs sur l'écran — l'écarter revenait à n'avoir
    // aucune durée, donc aucun €/h tant que TomTom n'avait pas répondu.
    //
    // On les distingue sans ambiguïté par la distance : celle du résumé est la
    // distance de la course, par définition.
    if (/km/i.test(block.text) && !isCourseSummary(block.text, courseDistanceKm)) continue;
    // Bloc d'info véhicule électrique → ces minutes ne sont pas la course.
    if (EV_CONTEXT_REGEX.test(block.text)) continue;
    const normalizedText = normalizeOcrDigits(block.text);
    const match = DURATION_REGEX.exec(normalizedText);
    if (!match) continue;
    const value = parseInt(match[1], 10);
    if (value < 1 || value > 180) continue;
    candidates.push({ value, y: block.y });
  }

  if (candidates.length === 0) return null;

  if (pickupAddr && destAddr) {
    const yMin = pickupAddr.y - 10;
    const yMax = destAddr.y + destAddr.height + 10;
    const inCourseZone = candidates.filter(c => c.y >= yMin && c.y <= yMax);
    if (inCourseZone.length > 0) return inCourseZone[0].value;
  }

  return candidates[0].value;
}

/**
 * Cette ligne « N min … D km » est-elle le RÉSUMÉ de la course ?
 *
 * Vrai quand la distance qu'elle porte est celle de la course. La tolérance
 * est large d'un dixième parce que les deux valeurs viennent du même texte,
 * mais pas forcément du même arrondi : la conversion des miles écrit une
 * décimale, et la distance retenue a pu passer par un autre chemin.
 */
function isCourseSummary(text: string, courseDistanceKm?: number | null): boolean {
  if (!courseDistanceKm) return false;
  const m = /(\d{1,3}(?:[.,]\d{1,2})?)\s*km/i.exec(normalizeOcrDigits(text));
  if (!m) return false;
  const km = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(km) && Math.abs(km - courseDistanceKm) <= 0.1;
}

// ─── Extraction pickup info (ligne combinée "X min • X,X km") ─────────────────

/**
 * Cherche une ligne contenant à la fois `min` et `km` — typiquement affichée
 * sous l'adresse de pickup par Uber/Bolt/Heetch. Retourne la plus haute
 * occurrence à l'écran pour éviter de matcher le résumé de la course.
 *
 * `courseDistanceKm` sert à exclure le match si la distance extraite correspond
 * à la distance totale de la course (évite les faux positifs).
 */
function extractPickupInfo(
  blocks: TextBlock[],
  courseDistanceKm: number,
  screenHeight: number,
): { durationMin: number; distanceKm: number } | null {
  const matches: { durationMin: number; distanceKm: number; y: number }[] = [];

  for (const block of blocks) {
    // Normalise "(l.2 km)" → "(1.2 km)" avant d'appliquer les regex pickup combo
    const text = normalizeOcrDigits(block.text);
    let minVal: number | null = null;
    let kmVal: number | null = null;

    const m1 = PICKUP_COMBO_MIN_FIRST.exec(text);
    if (m1) {
      minVal = parseInt(m1[1].replace(/\s+/g, ''), 10);
      kmVal = parseFloat(cleanNum(m1[2]));
    } else {
      const m2 = PICKUP_COMBO_KM_FIRST.exec(text);
      if (m2) {
        kmVal = parseFloat(cleanNum(m2[1]));
        minVal = parseInt(m2[2].replace(/\s+/g, ''), 10);
      }
    }

    if (minVal === null || kmVal === null) continue;
    if (minVal < 1 || minVal > 60) continue;          // pickup raisonnable
    if (kmVal < 0.1 || kmVal > 30) continue;
    if (Math.abs(kmVal - courseDistanceKm) < 0.1) continue; // c'est la course, pas le pickup
    // Le bandeau de navigation ("12 min · 5,4 km") est un combo lui aussi. Il se
    // distingue par sa POSITION — le quart haut de l'écran, la même bande que
    // `findAddressBlocks` écarte déjà — et non par ses kilomètres : une approche
    // plus longue que la course est banale en ville. Aligné Swift/Kotlin.
    if (block.y < screenHeight * 0.25) continue;

    matches.push({ durationMin: minVal, distanceKm: kmVal, y: block.y });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => a.y - b.y);                  // le pickup est toujours le plus haut
  const best = matches[0];
  return { durationMin: best.durationMin, distanceKm: best.distanceKm };
}

// ─── Extraction adresses (pickup + destination) ───────────────────────────────

function isAddressBlock(block: TextBlock): boolean {
  const text = block.text.toLowerCase().trim();
  if (text.length < 8 || text.length > 80) return false;

  // ── Filtre anti-stats : rejette les lignes qui sont manifestement des métriques
  // de course (et non des adresses). "Course de 11.8 km", "à 6 min (1.2 km)", etc.
  if (/course\s+de/.test(text)) return false;
  if (/\d[.,\s]*\d*\s*km\b/.test(text)) return false;
  if (/\d\s*min\b/.test(text)) return false;

  if (NON_ADDRESS_WORDS.some(w => text === w)) return false;
  // Rejet par substring : "3 UberX Exclusivité", "5 BoltPlus" ne sont jamais
  // des adresses même s'ils matchent le pattern digit+mot en dessous.
  if (/\b(uber\w*|bolt\w*|heetch\w*)\b/.test(text)) return false;
  // Ligne tarifaire (« 21,96 € (net, TTC) », « Accept €272,30 ») ou note
  // passager (« Walid • 5.0 * ») : jamais une adresse. Indispensables avant les
  // règles du code postal et de la virgule ci-dessous. Mirror Swift/Kotlin.
  if (CURRENCY_REGEX.test(text)) return false;
  if (/[★⭐]/.test(text) || /\b[0-5][.,]\d\b/.test(text)) return false;
  if (text.includes('net de frais') || text.includes('montant net')) return false;

  // 1. Mot-clé de voie/POI matché comme mot entier (évite "via" → "aviation")
  if (
    scanCountry === 'GB' &&
    UK_ONLY_STREET_KEYWORDS.some(k =>
      new RegExp(`(?<![a-zà-üß])${escapeRegex(k)}(?![a-zà-üß])`, 'i').test(text),
    )
  ) return true;
  if (ADDRESS_STREET_KEYWORDS.some(k =>
    new RegExp(`(?<![a-zà-üß])${escapeRegex(k)}(?![a-zà-üß])`, 'i').test(text)
  )) return true;

  // 2. Suffixes DE dans des mots composés ("Hauptstraße", "Friedrichstrasse")
  if (ADDRESS_STREET_SUFFIXES.some(s =>
    new RegExp(`[a-zà-üß]+${escapeRegex(s)}(?![a-zà-üß])`, 'i').test(text)
  )) return true;

  // 3. Code sortant + ville : « TW6, Hounslow ». C'est la SEULE forme
  //    d'adresse qu'Uber affiche au Royaume-Uni pour situer un lieu, et elle
  //    ne ressemble à aucune des structures ci-dessous — la destination d'une
  //    course britannique n'était donc pas détectée du tout, et sans elle
  //    TomTom n'a pas d'itinéraire à calculer.
  if (scanCountry === 'GB' && UK_OUTWARD_REGEX.test(text)) return true;

  // 4. Structure digit-first (FR/UK) : "10 rue de la Paix"
  if (/^\d{1,4}\s+[a-zà-ü]{5,}/i.test(text)) return true;
  // 5. Structure word-then-digit (DE/ES/IT) : "Hauptstraße 10", "Calle Alcalá, 10"
  if (/[a-zà-üß]{5,}[\s,]+\d{1,4}\s*$/i.test(text)) return true;
  // 6. Code postal + lettres, sans mot de voie connu : « Raoul Dautry, Saclay
  //    91400 ». Mirror Swift/Kotlin (règle 5), qui l'avaient seuls.
  if (/\b\d{4,5}\b/.test(text) && /[a-zà-üß]{3,}/.test(text)) return true;
  // 7. Virgule suivie d'une lettre + au moins 6 lettres : « Lyon, France »,
  //    destination d'une course longue. Mirror Swift/Kotlin (règle 6).
  if (/,\s*[a-zà-üß]/.test(text) && (text.match(/[a-zà-üß]/g) ?? []).length >= 6) return true;
  return false;
}

/**
 * Retourne les blocs d'adresse triés par Y croissant. Invariant VTC GARANTI :
 *   [0] = pickup (Y minimum, donc en haut de l'écran)
 *   [1] = destination (juste en dessous)
 * Tout le reste est ignoré par l'appelant (bruit : infos contextuelles).
 */
function findAddressBlocks(
  blocks: TextBlock[],
  screenHeight: number,
  fareBlockY?: number | null,
  fareInButton = false,
): TextBlock[] {
  let candidates = blocks
    .filter(b => b.y > screenHeight * 0.25)  // pas dans la zone prix/header
    .filter(isAddressBlock)
    .sort((a, b) => a.y - b.y);

  // Filtre ancre-prix : les vraies adresses sont dans le card-trip qui englobe
  // le prix. Fenêtre asymétrique (~5% au-dessus, ~50% en-dessous) — exclut les
  // labels de fond de carte Heetch/Bolt qui sont tous au-dessus du prix.
  // Prix dans le bouton d'acceptation : le bouton est SOUS la carte, la fenêtre
  // se retourne.
  if (fareBlockY != null) {
    const yMin = fareInButton
      ? fareBlockY - screenHeight * 0.5
      : fareBlockY - screenHeight * 0.05;
    const yMax = fareInButton
      ? fareBlockY + screenHeight * 0.05
      : fareBlockY + screenHeight * 0.5;
    candidates = candidates.filter(b => {
      const cy = b.y + b.height / 2;
      return cy >= yMin && cy <= yMax;
    });
  }

  // Filtre anti-map secondaire : si on a >2 candidats, on exige qu'ils soient
  // à proximité d'un bloc km/min.
  if (candidates.length > 2) {
    const metricRegex = /\d+\s*[.,]?\s*\d*\s*(?:km|min)\b/i;
    const metricYs = blocks
      .filter(b => metricRegex.test(b.text))
      .map(b => b.y + b.height / 2);
    if (metricYs.length > 0) {
      const radius = Math.max(screenHeight * 0.15, 300);
      candidates = candidates.filter(b => {
        // Une adresse avec code postal (4-5 chiffres) est un signal fort et sans
        // ambiguïté → jamais évincée, même loin d'un bloc km/min (cas Heetch dont
        // les adresses n'ont aucune métrique à proximité).
        if (POSTCODE_REGEX.test(b.text)) return true;
        const cy = b.y + b.height / 2;
        return metricYs.some(my => Math.abs(my - cy) <= radius);
      });
    }
  }

  // Retire les fins d'adresse coupées sur deux lignes (« Marne 94430 »,
  // « Point, W2 1HB ») : elles n'occupent pas un slot, sinon la destination est
  // évincée. Recollées à l'affichage par mergeAddressContinuation. Mirror Swift.
  candidates = candidates.filter(
    b => !candidates.some(head => head !== b && isContinuationLine(head, b, blocks)),
  );

  return collapseUkOutwardPairs(dedupOverlappingAddresses(candidates));
}

/**
 * Vrai si `tail` est la fin coupée de l'adresse `head` juste au-dessus : collée
 * (≤ 1 ligne), alignée, sans mot de voie ni numéro de rue en tête — sinon c'est
 * une nouvelle adresse. Mirror Swift/Kotlin `isContinuationLine`.
 */
function isContinuationLine(head: TextBlock, tail: TextBlock, allBlocks: TextBlock[]): boolean {
  if (tail.y <= head.y) return false;
  if (tail.y - (head.y + head.height) > head.height) return false;
  const xOverlap =
    Math.min(head.x + head.width, tail.x + tail.width) - Math.max(head.x, tail.x);
  if (xOverlap < Math.min(head.width, tail.width) * 0.5) return false;
  // Même bord gauche : une suite d'adresse repart de la même colonne (≤ 7 px
  // sur les vraies captures). Un libellé de la carte sous la fiche chevauche la
  // ligne mais part ailleurs — scan_debug #114, 289 px. Mirror Swift/Kotlin.
  if (Math.abs(tail.x - head.x) > head.height) return false;
  // Juste dessous : aucun bloc entre les deux. « Course de 1.9 km » séparait le
  // départ de la destination, recollée comme sa 2e ligne — scan_debug #115.
  const headBottom = head.y + head.height;
  const between = allBlocks.some(b => {
    if (b === head || b === tail) return false;
    const cy = b.y + b.height / 2;
    return cy > headBottom && cy < tail.y
      && Math.min(b.x + b.width, tail.x + tail.width) > Math.max(b.x, tail.x);
  });
  if (between) return false;
  const t = tail.text.trim();
  if (!t || t.length > 60) return false;
  if (/\d\s*(?:km|min)\b/i.test(t)) return false;
  if (/^\d{1,4}\s+[A-Za-zà-üÀ-Ü]/.test(t)) return false;
  const keywords =
    scanCountry === 'GB'
      ? [...ADDRESS_STREET_KEYWORDS, ...UK_ONLY_STREET_KEYWORDS]
      : ADDRESS_STREET_KEYWORDS;
  return !keywords.some(k =>
    new RegExp(`(?<![a-zà-üß])${escapeRegex(k)}(?![a-zà-üß])`, 'i').test(t),
  );
}

/**
 * Recolle « TW6, Hounslow » à la ligne de détail qui la suit.
 *
 * Uber écrit le lieu de prise en charge sur DEUX lignes au Royaume-Uni :
 *
 *     TW6, Hounslow
 *     Terminal 3, Level 3, Row A (Short Stay Car Park 3)
 *
 * Les deux sont des candidats une fois le code sortant reconnu — et deux
 * candidats pour UN lieu décalent tout : la ligne de détail prenait la place de
 * la destination, et la vraie destination tombait hors des deux premiers.
 *
 * On les fusionne donc en un seul candidat plutôt que de choisir. Choisir
 * aurait coûté quelque chose dans les deux sens : c'est la première ligne qui
 * GÉOCODE — « Terminal 3, Level 3, Row A » ne désigne aucun point sur Terre
 * sans sa ville, TomTom rendait un échec et la course retombait sur un
 * itinéraire estimé, donc sans trafic réel — mais c'est la seconde que le
 * chauffeur lit pour trouver son client.
 *
 * ROYAUME-UNI SEULEMENT, par `isAddressBlock` : ailleurs le code sortant n'est
 * jamais un candidat, et cette fonction ne trouve rien à fusionner.
 */
function collapseUkOutwardPairs(candidates: TextBlock[]): TextBlock[] {
  if (scanCountry !== 'GB' || candidates.length < 2) return candidates;

  const out: TextBlock[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const head = candidates[i];
    const next = candidates[i + 1];
    const isOutwardOnly =
      UK_OUTWARD_REGEX.test(head.text) && head.text.trim().length <= 40;

    if (isOutwardOnly && next) {
      const headBottom = head.y + head.height;
      const adjacent = next.y >= headBottom && next.y - headBottom <= head.height * 1.5;
      const xOverlap =
        Math.min(head.x + head.width, next.x + next.width) - Math.max(head.x, next.x);
      const overlapping = xOverlap >= Math.min(head.width, next.width) * 0.5;
      // La ligne suivante ne doit pas être elle-même un code sortant : deux
      // codes qui se suivent, ce sont un départ et une arrivée, pas un lieu.
      if (adjacent && overlapping && !UK_OUTWARD_REGEX.test(next.text)) {
        // On garde la ligne de DÉTAIL comme candidat et on écarte l'en-tête.
        // Le code postal n'est pas perdu : `mergeAddressContinuation` le
        // retrouve dans les blocs bruts et le recolle devant.
        //
        // Écarter plutôt que fusionner n'est pas un détail d'implémentation :
        // ML Kit ne laisse pas fabriquer de bloc côté Android, et les trois
        // parsers doivent rendre la même chaîne sur la même capture.
        continue;
      }
    }
    out.push(head);
  }
  return out;
}

/**
 * Si un candidat adresse est préfixe d'un autre (version courte vs riche), on
 * garde le plus long — l'info code postal + ville est précieuse pour TomTom.
 */
function dedupOverlappingAddresses(candidates: TextBlock[]): TextBlock[] {
  const texts = candidates.map(b => b.text.trim());
  return candidates.filter((_, i) => {
    const mine = texts[i];
    return !candidates.some((_, j) =>
      j !== i && texts[j].length > mine.length && texts[j].startsWith(mine)
    );
  });
}

// ─── Sanity check ─────────────────────────────────────────────────────────────

function isSane(fare: number, distanceKm: number, platform: ScanPlatform): boolean {
  if (fare < fareMinFor(platform) || fare > FARE_CEILING) return false;
  // Distance non affichée (Heetch) : TomTom tranchera.
  if (distanceKm === 0 && platform === 'HEETCH') return true;
  if (distanceKm < DIST_MIN || distanceKm > DIST_MAX) return false;
  if (fare / distanceKm < RATE_MIN) return false;
  return true;
}
