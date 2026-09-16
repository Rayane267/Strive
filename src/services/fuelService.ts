/**
 * Coût carburant par course — logique partagée Dashboard (calcul au scan) et
 * Analytics (agrégat). Un seul endroit à maintenir.
 *
 * Le prix du carburant change chaque jour : on le résout AU MOMENT du scan et
 * on le fige dans la course (fuel_cost / net_profit en DB), pour garder un
 * dataset daté et reproductible plutôt qu'un recalcul a posteriori faussé.
 */

import { supabase } from './supabase';
import { getMarket, type Market } from '../utils/market';

// Prix unitaires de repli, quand ni la table ni le chauffeur ne donnent de
// prix. Moyennes France ~2026, prudentes — et donc fausses ailleurs : c'est
// exactement pour ça que les marchés hors France demandent au chauffeur de
// saisir le sien. Ce repli n'est qu'un filet le temps qu'il le fasse.
export const DEFAULT_FUEL_PRICE: Record<string, number> = {
  essence: 1.85,
  diesel: 1.80,
  e85: 0.95,
  electric: 0.25,
};

/** Ce que le chauffeur a saisi lui-même, depuis Paramètres → Véhicule. */
export type DriverFuelPrices = {
  /** Prix au litre. Utilisé sur les marchés sans relevé (`market.fuelKey === null`). */
  fuelPrice?: number | null;
  /** Prix du kWh (véhicule électrique). Utilisé sur TOUS les marchés. */
  elecPrice?: number | null;
};

/**
 * Résout le prix unitaire du carburant pour un type donné. À appeler UNE fois
 * (au montage), pas à chaque scan — le scan est sensible à la latence.
 *
 * TROIS SOURCES, dans cet ordre :
 *
 *  1. Le prix SAISI par le chauffeur, dès qu'il en a saisi un. Il prime même en
 *     France : il connaît sa station mieux qu'une moyenne régionale, et il fait
 *     le plein toujours au même endroit.
 *  2. La table `fuel_prices`, pour les marchés qui ont un relevé quotidien —
 *     la France seule aujourd'hui (`market.fuelKey`). La ligne était `paris`
 *     en dur pour tout le monde : un chauffeur londonien se voyait déduire du
 *     gazole parisien en euros, et son coût, son bénéfice net et son verdict
 *     étaient faux tous les trois sans que rien ne le signale.
 *  3. `DEFAULT_FUEL_PRICE`, le filet.
 *
 * L'électrique n'a jamais eu de source marché — recharge domicile ou borne, le
 * prix varie du simple au triple — et suit déjà cette logique depuis toujours.
 */
export async function fetchFuelPrice(
  fuelType: string,
  driver: DriverFuelPrices | number | null = null,
  market: Market = getMarket(),
): Promise<number> {
  // Tolère l'ancienne signature `(fuelType, elecPrice)` : plusieurs écrans la
  // passaient encore telle quelle.
  const prices: DriverFuelPrices =
    typeof driver === 'number' || driver === null ? { elecPrice: driver } : driver;

  if (fuelType === 'electric') {
    return prices.elecPrice && prices.elecPrice > 0
      ? prices.elecPrice
      : DEFAULT_FUEL_PRICE.electric;
  }

  if (prices.fuelPrice && prices.fuelPrice > 0) return prices.fuelPrice;

  if (market.fuelKey) {
    try {
      const col = fuelType === 'diesel' ? 'diesel' : fuelType === 'e85' ? 'e85' : 'essence';
      const { data } = await supabase
        .from('fuel_prices')
        .select(col)
        .eq('id', market.fuelKey)
        .single();
      const price = data ? (Object.values(data)[0] as number) : 0;
      if (price && price > 0) return price;
    } catch {
      // Réseau/table absente → repli silencieux
    }
  }

  return DEFAULT_FUEL_PRICE[fuelType] ?? DEFAULT_FUEL_PRICE.essence;
}

/**
 * Coût carburant d'une course = (distance / 100) × conso × prix unitaire.
 * Retourne 0 si une donnée manque (conso non renseignée, prix indisponible).
 */
export function computeFuelCost(distanceKm: number, avgCons: number, fuelPrice: number): number {
  if (!(avgCons > 0) || !(fuelPrice > 0) || !(distanceKm > 0)) return 0;
  return Math.round((distanceKm / 100) * avgCons * fuelPrice * 100) / 100;
}
