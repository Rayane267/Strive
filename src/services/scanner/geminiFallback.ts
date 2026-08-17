/**
 * Fallback LLM (Niveau 2) quand le parsing OCR local retourne null ou des
 * valeurs aberrantes. On pousse l'image (déjà compressée côté natif) + un
 * prompt métier strict vers Gemini 1.5 Flash via notre edge function Supabase
 * (la clé API reste serveur, jamais dans le bundle client).
 *
 * Appelé depuis DashboardScreen après le premier résultat natif.
 */

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY } from '@env';
import { supabase } from '../supabase';
import { ScanResult, ScanPlatform } from './types';

const PROMPT = `Tu es un extracteur de données pour un chauffeur VTC. Analyse cette capture d'écran d'une proposition de course.
Règle absolue n°1 : L'adresse de départ (pickup) est TOUJOURS la première affichée en haut de l'écran. L'adresse de destination est TOUJOURS en dessous.
Règle absolue n°2 : Les prix sont souvent au format "XX,XX €" (virgule décimale, parfois avec espaces parasites — ex: "17 , 18 €" → 17.18).
Règle absolue n°3 : Les distances sont au format "X.X km" ou "X,X km". La distance de la course est presque toujours plus grande que la distance d'approche (pickup).
Règle absolue n°4 : Ne confonds JAMAIS une ligne stat ("Course de 11.8 km", "à 6 min (1.2 km)") avec une adresse.

Extrais les données EXACTES lues à l'écran (ne devine pas) et renvoie UNIQUEMENT un objet JSON valide sans markdown, avec cette structure exacte :
{
  "platform": "UBER" | "BOLT" | "HEETCH" | "UNKNOWN",
  "fare": <number, total affiché>,
  "distanceKm": <number, distance TOTALE de la course>,
  "durationMin": <number|null, durée course ; null si non visible>,
  "pickupAddress": <string, première adresse en haut>,
  "destinationAddress": <string, deuxième adresse en dessous>,
  "pickupDurationMin": <number|null, temps d'approche ; null si absent>,
  "pickupDistanceKm": <number|null, distance d'approche ; null si absente>
}
Si ce n'est pas un écran d'offre VTC : {"error":"not_a_ride"}.`;

const FARE_MIN = 8;
const FARE_MAX = 200;
const DIST_MIN = 0.3;
const DIST_MAX = 500;

// Aligné sur les sessions natives (GeminiVisionService.swift, timeoutIntervalForResource).
// Sans AbortController, `fetch` s'en remet au défaut de la plateforme — plus
// d'une minute sur iOS — et laisse le Dashboard en attente d'un scan mort.
const GEMINI_TIMEOUT_MS = 12_000;

export async function extractWithGemini(base64Image: string): Promise<ScanResult | null> {
  if (!base64Image || !PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64Image } },
          { text: PROMPT },
        ],
      }],
      // Lecture d'écran structurée : rien à raisonner. Sans ce bloc,
      // gemini-2.5-flash active son « thinking » dynamique et ajoute plusieurs
      // secondes sur le chemin le plus lent du scan. Aligné sur
      // GeminiVisionService.swift.
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 512,
      },
    };

    // L'edge function exige le JWT user (anti-DoW) — fallback sur l'anon key
    // si pas connecté (au cas où l'appel serait fait avant l'auth, ce qui ne
    // devrait jamais arriver côté Dashboard).
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? PUBLIC_SUPABASE_KEY;
    const res = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/gemini-proxy`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: PUBLIC_SUPABASE_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      __DEV__ && console.warn('[Scanner:Gemini] HTTP', res.status);
      return null;
    }

    const json = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim();

    const data = JSON.parse(cleaned);
    if (data?.error) return null;

    const fare = Number(data.fare);
    const distanceKm = Number(data.distanceKm);
    if (!Number.isFinite(fare) || fare < FARE_MIN || fare > FARE_MAX) return null;
    if (!Number.isFinite(distanceKm) || distanceKm < DIST_MIN || distanceKm > DIST_MAX) return null;
    // Ratio plausible : Gemini hallucine parfois une distance minuscule → €/km
    // démentiel. On rejette avant de remonter la course au Dashboard.
    const ratio = fare / distanceKm;
    if (ratio < 0.2 || ratio > 15) return null;

    const platform: ScanPlatform =
      (['UBER', 'BOLT', 'HEETCH'].includes(data.platform) ? data.platform : 'UNKNOWN');

    const durationMin =
      Number.isFinite(Number(data.durationMin)) ? Number(data.durationMin) : null;
    // Approche : bornes de OcrParser.extractPickupInfo (1–60 min, 0,1–30 km,
    // toujours plus courte que la course). Tout ou rien — une valeur seule
    // fausserait le total quand includePickup est ON. Aligné Swift/Kotlin.
    const rawPickupMin =
      Number.isFinite(Number(data.pickupDurationMin)) ? Number(data.pickupDurationMin) : undefined;
    const rawPickupKm =
      Number.isFinite(Number(data.pickupDistanceKm)) ? Number(data.pickupDistanceKm) : undefined;
    const pickupOk =
      rawPickupMin != null && rawPickupMin >= 1 && rawPickupMin <= 60 &&
      rawPickupKm != null && rawPickupKm >= 0.1 && rawPickupKm <= 30 &&
      rawPickupKm < distanceKm;

    return {
      platform,
      fare,
      distanceKm,
      durationMin,
      pickupAddress: typeof data.pickupAddress === 'string' ? data.pickupAddress : undefined,
      destinationAddress: typeof data.destinationAddress === 'string' ? data.destinationAddress : undefined,
      pickupDurationMin: pickupOk ? rawPickupMin : undefined,
      pickupDistanceKm: pickupOk ? rawPickupKm : undefined,
    };
  } catch (e) {
    // Couvre aussi l'AbortError du timeout ci-dessus : le Dashboard traite
    // `null` comme « fallback indisponible » et conserve le résultat natif.
    __DEV__ && console.warn('[Scanner:Gemini] parse error', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
