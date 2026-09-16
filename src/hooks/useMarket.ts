import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMarket, type Market } from '../utils/market';

/**
 * Le marché du chauffeur, pour les écrans.
 *
 * Existe pour qu'aucun écran n'ait à se demander d'où sort la devise : le pays
 * vient du profil, et de la région de l'appareil tant que le profil ne le dit
 * pas. Écrire `getMarket(profile?.country)` à la main dans chaque écran
 * marcherait aussi — mais c'est exactement comme ça que le « € » s'était
 * retrouvé recopié à 128 endroits.
 *
 * Mémoïsé sur le code pays : `getMarket` interroge `Intl` quand le profil est
 * muet, et un rendu de liste ne doit pas le refaire à chaque ligne.
 */
export function useMarket(): Market {
  const { profile } = useAuth();
  const country = profile?.country ?? null;
  return useMemo(() => getMarket(country), [country]);
}
