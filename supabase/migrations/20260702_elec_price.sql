-- ═══════════════════════════════════════════════════════════════════════════
-- Prix de recharge électrique configurable par l'utilisateur
-- ═══════════════════════════════════════════════════════════════════════════
-- L'électrique n'a pas de prix marché exploitable (recharge domicile ~0,25 €/kWh
-- vs borne rapide 0,40–0,70 €/kWh). On laisse donc le chauffeur saisir son
-- propre €/kWh. Colonne libre pour l'utilisateur (comme avg_cons) : NON couverte
-- par le trigger anti-tampering, modifiable via RLS owner. NULL → repli
-- DEFAULT_FUEL_PRICE.electric côté app.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists elec_price numeric
    check (elec_price is null or (elec_price > 0 and elec_price <= 3));
