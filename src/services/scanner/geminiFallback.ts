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

const FARE_MIN = 3;
const FARE_MAX = 200;
const DIST_MIN = 0.3;
const DIST_MAX = 1000;

export async function extractWithGemini(base64Image: string): Promise<ScanResult | null> {
  if (!base64Image || !PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_KEY) return null;

  try {
    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64Image } },
          { text: PROMPT },
        ],
      }],
    };

    // L'edge function exige le JWT user (anti-DoW) — fallback sur l'anon key
    // si pas connecté (au cas où l'appel serait fait avant l'auth, ce qui ne
    // devrait jamais arriver côté Dashboard).
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? PUBLIC_SUPABASE_KEY;
    const res = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/gemini-proxy`, {
      method: 'POST',
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

    const platform: ScanPlatform =
      (['UBER', 'BOLT', 'HEETCH'].includes(data.platform) ? data.platform : 'UNKNOWN');

    const durationMin =
      Number.isFinite(Number(data.durationMin)) ? Number(data.durationMin) : null;
    const pickupDurationMin =
      Number.isFinite(Number(data.pickupDurationMin)) ? Number(data.pickupDurationMin) : undefined;
    const pickupDistanceKm =
      Number.isFinite(Number(data.pickupDistanceKm)) ? Number(data.pickupDistanceKm) : undefined;

    return {
      platform,
      fare,
      distanceKm,
      durationMin,
      pickupAddress: typeof data.pickupAddress === 'string' ? data.pickupAddress : undefined,
      destinationAddress: typeof data.destinationAddress === 'string' ? data.destinationAddress : undefined,
      pickupDurationMin: pickupDurationMin != null && pickupDurationMin > 0 && pickupDurationMin <= 60
        ? pickupDurationMin : undefined,
      pickupDistanceKm: pickupDistanceKm != null && pickupDistanceKm >= 0.1 && pickupDistanceKm <= 30
        ? pickupDistanceKm : undefined,
    };
  } catch (e) {
    __DEV__ && console.warn('[Scanner:Gemini] parse error', e);
    return null;
  }
}
