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

const PLATFORM_KEYWORDS: Record<ScanPlatform, string[]> = {
  UBER:    ['uber'],
  BOLT:    ['bolt'],
  HEETCH:  ['heetch'],
  UNKNOWN: [],
};

const PRICE_ANCHORS: Record<ScanPlatform, string[]> = {
  UBER:    ['total', 'fare', 'trip fare', 'estimated fare'],
  BOLT:    ['gain', 'earning', 'revenu', 'estimé'],
  HEETCH:  ['course', 'tarif', 'prix'],
  UNKNOWN: ['total', 'gain', 'fare', 'tarif'],
};

const PRICE_REGEX    = /(\d{1,3})[.,](\d{2})(?!\d)/;
const DISTANCE_REGEX = /(\d{1,3}[.,]?\d{0,2})\s*km/i;
const DURATION_REGEX = /(\d{1,3})\s*min/i;

// Mots-clés de type voie — FR + EN — pour détecter les adresses
const ADDRESS_STREET_KEYWORDS = [
  'rue', 'avenue', 'av.', 'boulevard', 'blvd', 'place', 'pl.',
  'impasse', 'allée', 'allee', 'chemin', 'route', 'passage',
  'quai', 'villa', 'cité', 'cite', 'esplanade', 'cours',
  'faubourg', 'grande rue', 'voie', 'sq.', 'square',
  'street', 'road', 'lane', 'drive', 'st.', 'rd.', 'ave.', 'way',
];

// Mots à exclure des candidats adresse
const NON_ADDRESS_WORDS = [
  'uber', 'bolt', 'heetch', 'total', 'fare', 'gain', 'tarif',
  'accepted', 'accepté', 'min', 'km', 'estimated', 'estimé',
];

// ─── Sanity bounds ────────────────────────────────────────────────────────────

const FARE_MIN = 3;
const FARE_MAX = 200;
const DIST_MIN = 0.3;
const DIST_MAX = 150;
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

  const distanceKm = extractDistance(blocks);
  if (distanceKm === null) return null;

  if (!isSane(fare, distanceKm)) return null;

  const [pickupAddress, destinationAddress] = extractAddresses(blocks, screenHeight);

  return {
    platform,
    fare,
    distanceKm,
    durationMin: extractDuration(blocks),
    pickupAddress:     pickupAddress     ?? undefined,
    destinationAddress: destinationAddress ?? undefined,
  };
}

// ─── Détection plateforme ─────────────────────────────────────────────────────

function detectPlatform(fullText: string): ScanPlatform {
  for (const [platform, keywords] of Object.entries(PLATFORM_KEYWORDS) as [ScanPlatform, string[]][]) {
    if (platform === 'UNKNOWN') continue;
    if (keywords.some(k => fullText.includes(k))) return platform;
  }
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
    const match = PRICE_REGEX.exec(block.text);
    if (!match) return;

    const value = parseFloat(`${match[1]}.${match[2]}`);
    if (value < FARE_MIN || value > FARE_MAX) return;

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

// ─── Extraction distance ──────────────────────────────────────────────────────

function extractDistance(blocks: TextBlock[]): number | null {
  for (const block of blocks) {
    const match = DISTANCE_REGEX.exec(block.text);
    if (!match) continue;
    const value = parseFloat(match[1].replace(',', '.'));
    if (value >= DIST_MIN && value <= DIST_MAX) return value;
  }
  return null;
}

// ─── Extraction durée ─────────────────────────────────────────────────────────

function extractDuration(blocks: TextBlock[]): number | null {
  for (const block of blocks) {
    const match = DURATION_REGEX.exec(block.text);
    if (!match) continue;
    const value = parseInt(match[1], 10);
    if (value >= 1 && value <= 180) return value;
  }
  return null;
}

// ─── Extraction adresses (pickup + destination) ───────────────────────────────

function isAddressBlock(block: TextBlock): boolean {
  const text = block.text.toLowerCase().trim();
  if (text.length < 8 || text.length > 80) return false;
  if (NON_ADDRESS_WORDS.some(w => text === w)) return false;
  // Contient un mot-clé de type voie
  if (ADDRESS_STREET_KEYWORDS.some(k => text.includes(k))) return true;
  // Contient un numéro de rue suivi d'au moins 5 lettres
  if (/^\d{1,4}\s+[a-zà-ü]{5,}/i.test(text)) return true;
  return false;
}

/**
 * Retourne [pickupAddress, destinationAddress] extraites par ordre de position Y.
 * Le pickup est l'adresse la plus haute, la destination la plus basse.
 */
function extractAddresses(blocks: TextBlock[], screenHeight: number): [string | null, string | null] {
  const candidates = blocks
    .filter(b => b.y > screenHeight * 0.25)  // pas dans la zone prix/header
    .filter(isAddressBlock)
    .sort((a, b) => a.y - b.y);              // ordre vertical croissant

  return [
    candidates[0]?.text.trim() ?? null,
    candidates[1]?.text.trim() ?? null,
  ];
}

// ─── Sanity check ─────────────────────────────────────────────────────────────

function isSane(fare: number, distanceKm: number): boolean {
  if (fare < FARE_MIN || fare > FARE_MAX) return false;
  if (distanceKm < DIST_MIN || distanceKm > DIST_MAX) return false;
  const rate = fare / distanceKm;
  if (rate < RATE_MIN || rate > RATE_MAX) return false;
  return true;
}
