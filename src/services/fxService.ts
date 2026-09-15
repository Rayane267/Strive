/**
 * Taux de change entre les trois devises des marchés couverts.
 *
 * ── CE QUE ÇA SERT, ET CE QUE ÇA NE SERT PAS ──────────────────────────────
 * UNIQUEMENT à consolider des TOTAUX. Une course garde toujours ce qu'elle a
 * rapporté : `rides.currency` est figée à la création, et la ligne d'historique
 * affiche « 20 € » pour une course parisienne même après un passage à la livre.
 * C'est la somme — gains du jour, de la semaine, des Stats — qui a besoin d'une
 * monnaie commune, parce qu'additionner 200 € et 150 £ ne désigne rien.
 *
 * Le chiffre converti est donc un chiffre de LECTURE, pas un chiffre de compte.
 * Les écrans qui en affichent un le disent (`history.otherCurrency`), pour que
 * le chauffeur sache que son total contient une estimation et pourquoi il ne
 * tombera pas au centime sur son relevé.
 *
 * ── LE TAUX DU JOUR, PAS CELUI DE LA COURSE ───────────────────────────────
 * Un taux historique par course serait plus juste comptablement, mais
 * demanderait un appel par date et rendrait les totaux passés instables — ils
 * bougeraient à chaque révision. Le taux du jour donne un ordre de grandeur
 * stable sur une session, ce qui est exactement ce qu'on demande à un total
 * consolidé.
 *
 * ── POURQUOI UN REPLI ÉCRIT EN DUR ────────────────────────────────────────
 * Un chauffeur ouvre ses Stats dans un parking souterrain. Sans repli, le total
 * serait vide ou faux au moment précis où il le regarde. La photo ci-dessous
 * suffit à cet usage : elle sert d'ordre de grandeur, pas de référence, et le
 * cache prend le relais dès le premier passage en ligne.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import type { Currency } from '../utils/market';

export type FxRates = Record<Currency, number>;

/**
 * Photo des taux au 15/09/2026, base EUR. Uniquement un repli.
 *
 * Volontairement arrondie : afficher quatre décimales donnerait à croire à une
 * précision que ce tableau n'a pas. Il vieillit, et c'est assumé — l'écart
 * entre un taux d'il y a un an et celui du jour se compte en pourcents, ce qui
 * reste sans effet sur la décision que l'écran sert à prendre.
 */
export const FX_FALLBACK: FxRates = {
  EUR: 1,
  CHF: 0.94,
  GBP: 0.85,
};

const CACHE_KEY = 'fx_rates_v1';
/** Les taux d'un jour suffisent : ils bougent de quelques dixièmes de pourcent. */
const MAX_AGE_MS = 24 * 3600 * 1000;

/**
 * Frankfurter sert les taux de référence de la BCE, sans clé ni compte.
 *
 * Le choix compte : une API à clé aurait mis un secret de plus dans le build,
 * pour une donnée publique qu'une banque centrale publie déjà.
 */
const ENDPOINT = 'https://api.frankfurter.app/latest?from=EUR&to=CHF,GBP';

let memory: { rates: FxRates; at: number } | null = null;

function isValid(r: unknown): r is FxRates {
  const o = r as Partial<FxRates> | null;
  return (
    !!o &&
    typeof o.EUR === 'number' &&
    typeof o.CHF === 'number' &&
    typeof o.GBP === 'number' &&
    // Un taux nul ou négatif ferait une division par zéro plus loin, et un taux
    // absurde passerait inaperçu dans un total. Les trois monnaies se tiennent
    // largement dans cette fourchette.
    o.CHF > 0.1 && o.CHF < 10 && o.GBP > 0.1 && o.GBP < 10
  );
}

/**
 * Les taux, du plus frais au plus sûr : mémoire, cache disque, réseau, repli.
 *
 * Ne rejette jamais. Un écran de statistiques ne doit pas tomber parce qu'une
 * API de change est injoignable — il affiche un ordre de grandeur, et c'est
 * toujours mieux qu'un total amputé sans explication.
 */
export async function getFxRates(): Promise<FxRates> {
  const now = Date.now();
  if (memory && now - memory.at < MAX_AGE_MS) return memory.rates;

  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { rates: FxRates; at: number };
      if (isValid(parsed?.rates)) {
        memory = { rates: parsed.rates, at: parsed.at };
        if (now - parsed.at < MAX_AGE_MS) return parsed.rates;
      }
    }
  } catch {
    // Cache illisible : on ira au réseau, puis au repli.
  }

  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rates: FxRates = {
      EUR: 1,
      CHF: Number(body?.rates?.CHF),
      GBP: Number(body?.rates?.GBP),
    };
    if (!isValid(rates)) throw new Error('taux hors bornes');
    memory = { rates, at: now };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rates, at: now })).catch(() => {});
    return rates;
  } catch (error) {
    Sentry.addBreadcrumb({
      category: 'fx',
      message: `taux indisponibles : ${(error as Error)?.message}`,
      level: 'warning',
    });
    // Le cache périmé vaut mieux que la photo du build : il est au moins daté
    // de l'installation du chauffeur.
    return memory?.rates ?? FX_FALLBACK;
  }
}

/**
 * Un montant d'une devise vers une autre, via l'euro.
 *
 * Les taux sont tous exprimés en « unités par euro », donc le passage par l'EUR
 * n'est pas un détour : c'est le pivot du tableau. Passer par une autre monnaie
 * demanderait une seconde table sans rien apporter.
 */
export function convertAmount(
  amount: number,
  from: Currency,
  to: Currency,
  rates: FxRates,
): number {
  if (from === to) return amount;
  const inEur = amount / (rates[from] || 1);
  return inEur * (rates[to] || 1);
}

/**
 * Une course dont les montants sont exprimés dans la devise demandée.
 *
 * ── POURQUOI NORMALISER LA COURSE PLUTÔT QUE CHAQUE ADDITION ──────────────
 * Les montants d'une course ne servent pas qu'à être sommés : `qualityScore`
 * compare son tarif au kilomètre au seuil du chauffeur, `weeklyTease` chiffre
 * un manque à gagner, les graphiques divisent des gains par des heures. Tous
 * ces calculs cassent de la même façon sur une course en livres, et les
 * corriger un par un aurait laissé passer le prochain.
 *
 * On convertit donc UNE fois, à la sortie de la base, et tout ce qui suit
 * travaille dans une seule monnaie sans le savoir.
 *
 * `distance_km` ne bouge pas : un kilomètre reste un kilomètre d'un pays à
 * l'autre. Seuls les taux, qui ont de l'argent au numérateur, suivent.
 */
export function inCurrency<
  T extends {
    currency?: string | null;
    fx_rate_eur?: number | null;
    fare_estimated: number;
    fare_final?: number | null;
    hourly_rate?: number;
    km_rate?: number;
  },
>(ride: T, target: Currency, rates: FxRates): T {
  const from = (ride.currency ?? 'EUR') as Currency;
  if (from === target) return ride;
  // Le taux FIGÉ AU SCAN fait foi pour la première moitié du chemin : c'est lui
  // qui rend la valeur pivot de la course immuable, donc un total passé
  // reproductible. Le taux du jour ne sert qu'à la seconde moitié — de l'euro
  // vers la devise que le chauffeur lit aujourd'hui, qui est une présentation.
  const frozen = ride.fx_rate_eur;
  const c = (v: number) =>
    frozen && frozen > 0
      ? (v / frozen) * (rates[target] || 1)
      : convertAmount(v, from, target, rates);
  return {
    ...ride,
    fare_estimated: c(ride.fare_estimated),
    fare_final: ride.fare_final == null ? ride.fare_final : c(ride.fare_final),
    hourly_rate: ride.hourly_rate == null ? ride.hourly_rate : c(ride.hourly_rate),
    km_rate: ride.km_rate == null ? ride.km_rate : c(ride.km_rate),
    // La devise d'arrivée est portée explicitement : une course normalisée qui
    // garderait « EUR » serait reconvertie au prochain passage.
    currency: target,
  };
}

/** Combien de courses d'une liste ont dû être converties. */
export function countConverted(
  rides: { currency?: string | null }[],
  target: Currency,
): number {
  return rides.filter(r => (r.currency ?? 'EUR') !== target).length;
}

/** Pour les tests et le diagnostic : vide le cache mémoire. */
export function resetFxCache(): void {
  memory = null;
}
