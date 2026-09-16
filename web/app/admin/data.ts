'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { planById } from '../data/plans';
import type { Analytics, Feed, Live } from './types';

/* ──────────────────────────────────────────────────────────────────────────
   Accès aux quatre RPC de la console. Un seul endroit : l'accueil et les
   pages de détail lisent les mêmes données, et une page ouverte depuis une
   tuile ne doit pas afficher un chiffre différent de celui de la tuile.
   ────────────────────────────────────────────────────────────────────────── */

type State<T> = { data: T | null; err: string };

function useRpc<T>(fn: string, params: Record<string, unknown>, deps: unknown[]): State<T> {
  const [s, setS] = useState<State<T>>({ data: null, err: '' });
  useEffect(() => {
    let cancelled = false;
    supabase.rpc(fn, params).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setS({ data: null, err: error.message });
      else setS({ data: data as T, err: '' });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

export const useAnalytics = (days: number) =>
  useRpc<Analytics>('admin_analytics', { p_days: days }, [days]);

export const useFeed = (days: number, limit = 25) =>
  useRpc<Feed>('admin_feed', { p_days: days, p_limit: limit }, [days, limit]);

/** Le temps réel se rafraîchit tout seul, et s'arrête quand l'onglet passe en
 *  arrière-plan : une console laissée ouverte interrogerait la base 2 880 fois
 *  par jour pour personne. */
export function useLive(refreshMs = 30_000): State<Live> {
  const [s, setS] = useState<State<Live>>({ data: null, err: '' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      const { data, error } = await supabase.rpc('admin_live');
      if (cancelled) return;
      if (error) setS({ data: null, err: error.message });
      else setS({ data: data as Live, err: '' });
    };
    const start = () => { if (!timer) timer = setInterval(load, refreshMs); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { load(); start(); } else stop();
    };

    load();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelled = true; stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refreshMs]);

  return s;
}

/* ── Revenu ──────────────────────────────────────────────────────────────
   Les prix ne sont PAS recopiés ici : ils viennent de `app/data/plans.ts`,
   la même source que les cartes tarifaires du site, donc la grille App
   Store. Un annuel compte pour un douzième — ce qu'il rapporte par mois,
   pas ce qu'il a encaissé d'un coup. */
export function monthlyValue(productId: string): number | null {
  const plus = planById('plus');
  const premium = planById('premium');
  switch (productId) {
    case 'strive_plus_monthly':    return plus.amount.monthly;
    case 'strive_plus_yearly':     return plus.amount.yearly / 12;
    case 'strive_premium_monthly': return premium.amount.monthly;
    case 'strive_premium_yearly':  return premium.amount.yearly / 12;
    default:                       return null;
  }
}

export function mrrFrom(rows: { product_id: string; total: number }[]) {
  let known = 0;
  let unknown = 0;
  for (const r of rows) {
    const v = monthlyValue(r.product_id);
    if (v == null) unknown += r.total;
    else known += v * r.total;
  }
  return { mrr: Math.round(known * 100) / 100, unknown };
}

export const PRODUCT_LABEL: Record<string, string> = {
  strive_plus_monthly:    'Plus · mensuel',
  strive_plus_yearly:     'Plus · annuel',
  strive_premium_monthly: 'Premium · mensuel',
  strive_premium_yearly:  'Premium · annuel',
};
