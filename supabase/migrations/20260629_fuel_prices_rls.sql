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

-- La table avait été créée à la main (SQL Editor) et n'existait dans AUCUNE
-- migration : rejouer l'historique sur un projet neuf s'arrêtait ici. On la
-- crée donc avant d'y poser la RLS. `if not exists` → sans effet en production,
-- où elle est déjà là, ce qui préserve l'idempotence annoncée plus haut.
-- Colonnes conformes à ce qu'écrit l'edge function `fuel-prices` (upsert sur
-- `id`) et à ce que lit `fuelService.fetchFuelPrice` (ligne 'paris').
create table if not exists public.fuel_prices (
  id         text primary key,
  essence    numeric(6, 3),
  diesel     numeric(6, 3),
  e85        numeric(6, 3),
  updated_at timestamptz not null default now()
);

alter table public.fuel_prices enable row level security;

drop policy if exists "fuel_prices_select_authenticated" on public.fuel_prices;
create policy "fuel_prices_select_authenticated"
  on public.fuel_prices for select
  to authenticated
  using (true);

-- Pas de policy INSERT/UPDATE/DELETE → écriture réservée au service_role
-- (edge function fuel-prices / Dashboard SQL Editor).
