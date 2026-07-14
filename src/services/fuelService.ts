/**
 * Coût carburant par course — logique partagée Dashboard (calcul au scan) et
 * Analytics (agrégat). Un seul endroit à maintenir.
 *
 * Le prix du carburant change chaque jour : on le résout AU MOMENT du scan et
 * on le fige dans la course (fuel_cost / net_profit en DB), pour garder un
 * dataset daté et reproductible plutôt qu'un recalcul a posteriori faussé.
 */

import { supabase } from './supabase';

// Prix unitaires de repli (€/L, ou €/kWh pour l'électrique) quand la table
// `fuel_prices` n'est pas alimentée. Moyennes France ~2026, prudentes.
// L'électrique n'a pas de colonne en base → toujours ce repli.
export const DEFAULT_FUEL_PRICE: Record<string, number> = {
  essence: 1.85,
  diesel: 1.80,
  e85: 0.95,
  electric: 0.25,
};

/**
 * Résout le prix unitaire du carburant pour un type donné : table `fuel_prices`
 * (région Paris) puis repli sur DEFAULT_FUEL_PRICE. À appeler UNE fois (au
 * montage), pas à chaque scan — le scan est sensible à la latence.
 */
export async function fetchFuelPrice(fuelType: string, elecPrice?: number | null): Promise<number> {
  // Électrique : prix €/kWh personnalisé par l'utilisateur (profiles.elec_price),
  // repli sur le défaut. Pas de source marché (recharge très variable domicile/borne).
  if (fuelType === 'electric') {
    return elecPrice && elecPrice > 0 ? elecPrice : DEFAULT_FUEL_PRICE.electric;
  }
  try {
    const col = fuelType === 'diesel' ? 'diesel' : fuelType === 'e85' ? 'e85' : 'essence';
    const { data } = await supabase
      .from('fuel_prices')
      .select(col)
      .eq('id', 'paris')
      .single();
    const price = data ? (Object.values(data)[0] as number) : 0;
    if (price && price > 0) return price;
  } catch {
    // Réseau/table absente → repli silencieux
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
