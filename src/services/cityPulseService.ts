// Vue « Événements et perturbations » : lecture de `city_signals`.
//
// La table est remplie côté serveur par l'edge function `city-pulse`
// (perturbations IDFM/TCL/RTM, vagues de trains SNCF, Ligue 1, événements
// relevés à la main). L'app ne fait que lire.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type City = 'paris' | 'lyon' | 'marseille' | 'nice';
export const CITIES: City[] = ['paris', 'lyon', 'marseille', 'nice'];

export type CitySignal = {
  id: string;
  source: string;
  city: City;
  kind: 'transit_disruption' | 'train_arrivals' | 'event' | string;
  title: string;
  detail: string | null;
  place: string | null;
  mode: string | null;
  lat: number | null;
  lon: number | null;
  starts_at: string | null;
  ends_at: string | null;
  intensity: number;
  items: TrainItem[] | null;
  updated_at: string;
};

export type TrainItem = {
  at: string;
  mode: string;
  number: string | null;
  origin: string | null;
  delay: number;
  seats: number;
  /** Fait partie de la vague mise en avant (absent sur les anciennes lignes = oui). */
  wave?: boolean;
};

const CITY_KEY = 'cityPulse.city';

export async function loadCity(): Promise<City> {
  try {
    const v = await AsyncStorage.getItem(CITY_KEY);
    if (v && (CITIES as string[]).includes(v)) return v as City;
  } catch {
    // Préférence de confort : sans stockage, Paris par défaut.
  }
  return 'paris';
}

export async function saveCity(city: City): Promise<void> {
  try {
    await AsyncStorage.setItem(CITY_KEY, city);
  } catch {
    // idem
  }
}

/** Perturbations (transports + vagues de trains) et événements d'une ville. */
export async function fetchCitySignals(city: City): Promise<CitySignal[]> {
  const { data, error } = await supabase
    .from('city_signals')
    .select('*')
    .eq('city', city)
    .order('intensity', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CitySignal[];
}

/** Une vague de trains déjà passée ou un événement fini ne s'affiche plus. */
export function isCurrent(s: CitySignal, now = Date.now()): boolean {
  if (s.kind === 'transit_disruption') return true;
  const end = s.ends_at ? Date.parse(s.ends_at) : s.starts_at ? Date.parse(s.starts_at) + 86_400_000 : Infinity;
  return end >= now;
}

export const isDisruption = (s: CitySignal) => s.kind === 'transit_disruption' || s.kind === 'train_arrivals';
