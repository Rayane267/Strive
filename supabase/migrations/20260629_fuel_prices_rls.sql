-- ═══════════════════════════════════════════════════════════════════════════
-- Fix intégrité : RLS sur fuel_prices (table marquée UNRESTRICTED)
-- ═══════════════════════════════════════════════════════════════════════════
-- Problème (audit Strive) : fuel_prices n'avait AUCUNE RLS → tout porteur de la
-- clé anon pouvait INSERT/UPDATE/DELETE le prix du carburant (ligne 'paris').
-- Or ce prix est figé dans chaque course (fuel_cost / net_profit) au scan : un
-- utilisateur malveillant pouvait corrompre le coût carburant de TOUS les
-- chauffeurs. Le client ne fait que lire (cf. fuelService.fetchFuelPrice).
--
-- Modèle (aligné sur parser_config / vehicles_db) :
--   - lecture publique authentifiée,
--   - aucune policy d'écriture → INSERT/UPDATE/DELETE bloqués pour authenticated,
--   - l'edge function fuel-prices écrit via service_role (bypasse la RLS).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fuel_prices enable row level security;

drop policy if exists "fuel_prices_select_authenticated" on public.fuel_prices;
create policy "fuel_prices_select_authenticated"
  on public.fuel_prices for select
  to authenticated
  using (true);

-- Pas de policy INSERT/UPDATE/DELETE → écriture réservée au service_role
-- (edge function fuel-prices / Dashboard SQL Editor).
