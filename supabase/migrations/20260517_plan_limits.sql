-- ═══════════════════════════════════════════════════════════════════════════
-- Table plan_limits — limites configurables par tier
-- ═══════════════════════════════════════════════════════════════════════════
-- Avant : limites hardcodées dans subscriptionService.ts (JS) ET dans
-- enforce_scan_quota (SQL). Toute modif nécessitait un déploiement app + DB.
--
-- Après : une seule source de vérité (cette table). Pour changer les limites :
--   update plan_limits set daily_scans = X where tier = 'plus';
-- L'app picke le nouveau quota au prochain démarrage (cache TTL côté JS).
--
-- Politique actuelle (modifiable en SQL après cette migration) :
--   - free    : 3 scans/jour
--   - plus    : 15 scans/jour
--   - premium : illimité (daily_scans = NULL convention)
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Table plan_limits
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.plan_limits (
  tier         text primary key check (tier in ('free', 'plus', 'premium', 'pro')),
  daily_scans  int check (daily_scans is null or daily_scans >= 0),
  updated_at   timestamptz not null default now(),
  -- NULL = unlimited (convention partagée avec PLAN_LIMITS côté JS)
  notes        text
);

alter table public.plan_limits enable row level security;

-- Lecture publique authentifiée : tous les users peuvent connaître les
-- limites des tiers (pour afficher "passer Plus = 15/jour" sur paywall, etc.)
drop policy if exists "plan_limits_read" on public.plan_limits;
create policy "plan_limits_read"
  on public.plan_limits for select
  to authenticated
  using (true);

-- Écriture : service_role only (via Dashboard SQL Editor).


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Seed initial — modifiables à tout moment via UPDATE
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.plan_limits (tier, daily_scans, notes) values
  ('free',    3,    'Gratuit'),
  ('plus',    15,   'Plus mensuel/annuel'),
  ('premium', null, 'Illimité')
on conflict (tier) do update set
  daily_scans = excluded.daily_scans,
  notes = excluded.notes,
  updated_at = now();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Refacto enforce_scan_quota → lit la table au lieu de hardcoder
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;        -- préfixe v_ pour éviter conflit avec colonne plan_limits.tier
  daily_limit int;    -- NULL = unlimited
  count_today int;
  credits int;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  select coalesce(subscription_tier, 'free'),
         coalesce(extra_scan_credits, 0)
    into v_tier, credits
    from public.profiles where id = new.user_id;

  -- Lookup limite depuis la table — fallback 'free' si tier inconnu
  select pl.daily_scans into daily_limit
    from public.plan_limits pl
    where pl.tier = v_tier;
  if not found then
    select pl.daily_scans into daily_limit
      from public.plan_limits pl
      where pl.tier = 'free';
  end if;

  -- daily_limit = NULL → unlimited (premium), aucun check
  if daily_limit is null then
    return new;
  end if;

  select count(*) into count_today
    from public.rides
    where user_id = new.user_id
      and created_at >= date_trunc('day', now() at time zone 'Europe/Paris');

  if count_today >= daily_limit and credits <= 0 then
    raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
  end if;

  if count_today >= daily_limit and credits > 0 then
    perform set_config('app.bypass_tier_check', 'on', true);
    update public.profiles
      set extra_scan_credits = extra_scan_credits - 1
      where id = new.user_id;
  end if;

  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Limites visibles côté client :
--    select * from plan_limits;
--    → 3 rows (free=3, plus=15, premium=null)
--
-- 2. Modif à chaud :
--    update plan_limits set daily_scans = 5 where tier = 'free';
--    → l'app picke 5/jour au prochain reload
--
-- 3. Quota free à 3 :
--    En tant que user free, scanner 4× → 4e échoue "daily_scan_quota_exceeded"
--
-- 4. Quota plus à 15 :
--    En tant que user plus, scanner 16× → 16e échoue
