-- ═══════════════════════════════════════════════════════════════════════════
-- Préférence « retirer le carburant du prix »
-- ═══════════════════════════════════════════════════════════════════════════
-- Affichage uniquement : quand elle est active, le prix montré dans la Live
-- Activity est net du carburant estimé de la course. Les métriques de décision
-- (€/h, €/km, verdict) et le tarif enregistré en base restent BRUTS — sinon les
-- seuils de l'utilisateur changeraient de sens sans qu'il l'ait demandé, et
-- fare_estimated ne correspondrait plus à ce qu'affiche l'app VTC.
--
-- Le coût carburant par course reste porté par rides.fuel_cost / net_profit,
-- figés au scan avec le prix du carburant du jour.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.preferences
  add column if not exists deduct_fuel boolean not null default false;

comment on column public.preferences.deduct_fuel is
  'Affiche le prix des courses net du carburant estimé (Live Activity). N''affecte ni le verdict ni les tarifs stockés.';
