/**
 * Les taux de change, pour un écran qui somme PENDANT son rendu.
 *
 * ── POURQUOI UN HOOK ALORS QUE `normalizeRides` EXISTE ────────────────────
 * Presque tous les écrans convertissent dans un effet, où l'on peut attendre :
 * `normalizeRides(rides, devise)` y suffit, et c'est la forme à préférer. Mais
 * l'Historique calcule son total du jour à chaque rendu, à partir d'une liste
 * déjà filtrée en mémoire — il n'a pas d'endroit où attendre une promesse.
 *
 * D'où un état, et un seul : les taux. La conversion elle-même reste
 * `inCurrency`, avec la devise du chauffeur pour tout argument.
 *
 * ── PAS DE CLIGNOTEMENT APRÈS LE PREMIER ÉCRAN ────────────────────────────
 * L'état démarre sur `peekFxRates()` — le cache mémoire de la session, déjà
 * rempli dès qu'un écran a converti quoi que ce soit. Seul le tout premier
 * rendu de la session peut donc partir du repli, et il n'a rien de mieux sous
 * la main. Sans ça, revenir sur l'Historique faisait bouger le total sous les
 * yeux du chauffeur à chaque visite.
 */
import { useEffect, useState } from 'react';
import { getFxRates, peekFxRates, type FxRates } from '../services/fxService';

export function useFxRates(): FxRates {
  const [rates, setRates] = useState<FxRates>(peekFxRates);

  useEffect(() => {
    let cancelled = false;
    getFxRates().then(r => {
      if (!cancelled) setRates(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return rates;
}
