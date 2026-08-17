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
  /(autonomie|recharg|borne\s|batterie|électrique|electrique|kwh|\bev\b|charging|battery|\brange\b)/i;
// Ligne combinée pickup : "4 min • 1,2 km" ou "1,2 km • 4 min" avec séparateurs variés (•·-–—:, espaces)
const PICKUP_COMBO_MIN_FIRST = /(\d{1,3})\s*min[^0-9a-zà-ü]{0,6}(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km/i;
const PICKUP_COMBO_KM_FIRST  = /(\d{1,3}(?:\s*[.,]\s*\d{1,2})?)\s*km[^0-9a-zà-ü]{0,6}(\d{1,3})\s*min/i;

// Mots-clés de type voie — FR + EN — pour détecter les adresses
// Mots de voie à matcher comme MOT ENTIER (FR, EN, ES, IT, NL, PT) + POIs
const ADDRESS_STREET_KEYWORDS = [
  // FR
  'rue', 'avenue', 'av.', 'boulevard', 'blvd', 'bd', 'bd.',
  'place', 'pl.', 'impasse', 'imp.', 'allée', 'allee', 'all.',
  'chemin', 'ch.', 'route', 'rte', 'rte.', 'passage',
  'quai', 'villa', 'cité', 'cite', 'esplanade', 'cours',
  'faubourg', 'fg.', 'voie', 'sq.', 'square',
  // EN
  'street', 'road', 'lane', 'drive', 'st.', 'rd.', 'ave.', 'way',
  // ES
  'calle', 'avenida', 'plaza', 'paseo', 'carretera', 'camino', 'ronda',
  // IT
  'via', 'viale', 'corso', 'piazza', 'strada', 'vicolo', 'largo',
  // NL
  'straat', 'laan', 'plein', 'gracht',
  // PT
  'travessa', 'rua',
  // POIs FR/EN + traductions EU
  'gare', 'aéroport', 'aeroport', 'airport', 'terminal',
  'porte', 'hôpital', 'hopital', 'hospital', 'station',
  'bahnhof', 'hauptbahnhof', 'flughafen', 'krankenhaus',
  'estación', 'estacion', 'aeropuerto',
  'stazione', 'aeroporto', 'ospedale',
];
// Suffixes DE qui forment des mots composés (Hauptstraße). Matchés en fin de mot.
const ADDRESS_STREET_SUFFIXES = [
  'straße', 'strasse', 'str.', 'gasse', 'weg', 'allee', 'platz',
  'damm', 'ufer', 'ring',
];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  'uber', 'bolt', 'heetch', 'total', 'fare', 'gain', 'tarif',
  'accepted', 'accepté', 'min', 'km', 'estimated', 'estimé',
];

// ─── Sanity bounds ────────────────────────────────────────────────────────────

const FARE_MIN = 8;
const FARE_MAX = 200;
const DIST_MIN = 0.3;
const DIST_MAX = 500;
const RATE_MIN = 0.4;  // €/km
const RATE_MAX = 12;   // €/km

// ─── Entry point ──────────────────────────────────────────────────────────────

export function parseBlocks(
  blocks: TextBlock[],
  screenHeight: number,
): ScanResult | null {
  if (blocks.length === 0) return null;

  const fullText = blocks.map(b => b.text).join(' ').toLowerCase();
  const platform = detectPlatform(fullText);

  const fare = extractFare(blocks, platform, screenHeight);
  if (fare === null) return null;
  const fareBlockY = locateFareBlockY(blocks, fare);

  // Invariant layout VTC : la pickup est toujours la 1ʳᵉ adresse (Y le + haut),
  // la destination la 2ᵉ. On s'en sert pour catégoriser les km/min ambigus.
  const addressBlocks = findAddressBlocks(blocks, screenHeight, fareBlockY);
  const pickupAddrBlock = addressBlocks[0];
  const destAddrBlock = addressBlocks[1];

  const distanceKm = extractDistance(blocks, pickupAddrBlock, destAddrBlock);
  if (distanceKm === null) return null;

  if (!isSane(fare, distanceKm)) return null;

  const pickup = extractPickupInfo(blocks, distanceKm);

  return {
    platform,
    fare,
    distanceKm,
    durationMin: extractDuration(blocks, pickupAddrBlock, destAddrBlock),
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
  const addrBottom = addrBlock.y + addrBlock.height;
  const addrRight = addrBlock.x + addrBlock.width;

  const continuation = allBlocks.find(other => {
    if (other === addrBlock) return false;
    if (other.y <= addrBlock.y) return false;
    if (other.y - addrBottom > addrBlock.height) return false;
    const xOverlap = Math.min(addrRight, other.x + other.width) - Math.max(addrBlock.x, other.x);
    const minWidth = Math.min(addrBlock.width, other.width);
    if (xOverlap < minWidth * 0.5) return false;
    const t = other.text.trim();
    if (!t || t.length > 60) return false;
    if (/\d\s*(?:km|min)\b/i.test(t)) return false;
    if (/^\d{1,4}\s+[A-Za-zà-üÀ-Ü]/.test(t)) return false;
    if (isAddressBlock(other)) return false;
    return true;
  });

  if (!continuation) return baseText;
  const contText = continuation.text.trim();
  return baseText.endsWith('-') ? `${baseText}${contText}` : `${baseText}\n${contText}`;
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

function extractFare(
  blocks: TextBlock[],
  platform: ScanPlatform,
  screenHeight: number,
): number | null {
  const anchors = PRICE_ANCHORS[platform] ?? PRICE_ANCHORS.UNKNOWN;

  const candidates: { value: number; score: number }[] = [];

  blocks.forEach((block, idx) => {
    const normalizedText = normalizeOcrDigits(block.text);
    // Exclut les boutons de suggestion de prix Heetch ("Proposer X €")
    if (/proposer/i.test(normalizedText)) return;

    // Retire la note de l'app ("★ 5,00", "* 5,00") : un nombre précédé d'une
    // étoile n'est jamais un tarif. Évite que "5,00" l'emporte via l'ancre "net"
    // du libellé "Montant net de frais" collé juste à côté.
    const deRated = normalizedText.replace(/[★⭐✩✪✯*]\s*\d{1,2}\s*[.,]\s*\d{1,2}/g, ' ');

    let value: number | null = null;
    const match = PRICE_REGEX.exec(deRated);
    if (match) {
      value = parseFloat(`${match[1].replace(/\s+/g, '')}.${match[2].replace(/\s+/g, '')}`);
    } else {
      // Tarif "collé" à l'euro, virgule perdue par l'OCR ("17,43 €" → "1743€").
      // Les apps VTC affichent toujours 2 décimales : si l'entier dépasse le
      // plafond plausible, on réinterprète les 2 derniers chiffres en centimes.
      // Deux chiffres ou plus, OU un chiffre seul de 6 à 9 : une course à 9 €
      // existe (tarif minimum VTC), alors qu'un "5€" sec est presque toujours un
      // pourboire suggéré, un pack ou une note — cf. fixture canonique. La regex
      // reste plus large que le plancher FARE_MIN (8 €), qui écarte 6 et 7.
      const glued = /(\d{2,6}|[6-9])\s*€/.exec(deRated);
      if (glued) {
        const raw = parseInt(glued[1], 10);
        value = raw > FARE_MAX ? raw / 100 : raw;
      }
    }
    if (value === null || value < FARE_MIN || value > FARE_MAX) return;

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

    candidates.push({ value, score });
  });

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.score - a.score)[0].value;
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
): number | null {
  const candidates: { value: number; y: number }[] = [];

  for (const block of blocks) {
    if (/km/i.test(block.text)) continue;
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

  // 1. Mot-clé de voie/POI matché comme mot entier (évite "via" → "aviation")
  if (ADDRESS_STREET_KEYWORDS.some(k =>
    new RegExp(`(?<![a-zà-üß])${escapeRegex(k)}(?![a-zà-üß])`, 'i').test(text)
  )) return true;

  // 2. Suffixes DE dans des mots composés ("Hauptstraße", "Friedrichstrasse")
  if (ADDRESS_STREET_SUFFIXES.some(s =>
    new RegExp(`[a-zà-üß]+${escapeRegex(s)}(?![a-zà-üß])`, 'i').test(text)
  )) return true;

  // 3. Structure digit-first (FR/UK) : "10 rue de la Paix"
  if (/^\d{1,4}\s+[a-zà-ü]{5,}/i.test(text)) return true;
  // 4. Structure word-then-digit (DE/ES/IT) : "Hauptstraße 10", "Calle Alcalá, 10"
  if (/[a-zà-üß]{5,}[\s,]+\d{1,4}\s*$/i.test(text)) return true;
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
): TextBlock[] {
  let candidates = blocks
    .filter(b => b.y > screenHeight * 0.25)  // pas dans la zone prix/header
    .filter(isAddressBlock)
    .sort((a, b) => a.y - b.y);

  // Filtre ancre-prix : les vraies adresses sont dans le card-trip qui englobe
  // le prix. Fenêtre asymétrique (~5% au-dessus, ~35% en-dessous) — exclut les
  // labels de fond de carte Heetch/Bolt qui sont tous au-dessus du prix.
  if (fareBlockY != null) {
    const yMin = fareBlockY - screenHeight * 0.05;
    const yMax = fareBlockY + screenHeight * 0.5;
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
        if (/\b\d{4,5}\b/.test(b.text)) return true;
        const cy = b.y + b.height / 2;
        return metricYs.some(my => Math.abs(my - cy) <= radius);
      });
    }
  }

  return dedupOverlappingAddresses(candidates);
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

function locateFareBlockY(blocks: TextBlock[], fare: number): number | null {
  const euros = Math.floor(fare);
  const cents = Math.round((fare - euros) * 100);
  const centsStr = cents.toString().padStart(2, '0');
  const patterns = [`${euros},${centsStr}`, `${euros}.${centsStr}`];
  let match = blocks.find(b => patterns.some(p => b.text.includes(p)));
  // Repli : tarif collé sans virgule ("1743€") — on exige le € pour éviter de
  // matcher un code postal ou une heure qui contiendrait la même suite.
  if (!match) {
    const glued = `${euros}${centsStr}`;
    match = blocks.find(b => b.text.includes(glued) && b.text.includes('€'));
  }
  if (!match) return null;
  return match.y + match.height / 2;
}

// ─── Sanity check ─────────────────────────────────────────────────────────────

function isSane(fare: number, distanceKm: number): boolean {
  if (fare < FARE_MIN || fare > FARE_MAX) return false;
  if (distanceKm < DIST_MIN || distanceKm > DIST_MAX) return false;
  const rate = fare / distanceKm;
  if (rate < RATE_MIN || rate > RATE_MAX) return false;
  return true;
}
