-- ═══════════════════════════════════════════════════════════════════════════
-- rides.fuel_cost / rides.net_profit — colonnes déclarées en migration
-- ═══════════════════════════════════════════════════════════════════════════
-- `ridesService` les lit dans RIDE_COLUMNS, les écrit dans createRide et patche
-- `net_profit` dans updateRideFare, mais aucune migration ne les ajoutait :
-- elles avaient été créées à la main dans le SQL Editor. Sur toute base
-- reconstruite depuis `supabase/migrations`, chaque `fetchRides` répond 400 et
-- chaque `createRide` échoue en PGRST204 — et comme le Dashboard traite l'échec
-- de createRide comme une panne réseau, TOUS les scans partent en file offline.
--
-- Le coût carburant est figé dans la course au moment du scan (le prix du
-- carburant du jour), pas recalculé après coup : ces deux colonnes portent donc
-- une valeur historique, d'où `numeric` et non une vue calculée.
--
-- `rides` elle-même ne figure dans aucune migration (schéma d'origine créé
-- via le dashboard) : le bloc est guardé par `to_regclass`, même discipline que
-- `cars` dans 20260425_rls_policies.sql, pour qu'un replay à blanc n'échoue pas
-- ici. Il ne recrée pas le schéma de base, il ne prétend pas le faire.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.rides') is null then return; end if;

  alter table public.rides add column if not exists fuel_cost  numeric(10, 2);
  alter table public.rides add column if not exists net_profit numeric(10, 2);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'rides'
--      and column_name in ('fuel_cost', 'net_profit');
--   → doit rendre deux lignes.
