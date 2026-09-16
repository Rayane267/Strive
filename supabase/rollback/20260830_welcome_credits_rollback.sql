-- Rollback de 20260830_welcome_credits.sql
--
-- Ramène le quota à l'état de 20260822_scan_quota_on_profile.sql : deux pools
-- deviennent un, seul `extra_scan_credits` reste consommable.
--
-- `profiles.welcome_credits` et `welcome_credits_expires_at` ne sont PAS
-- supprimées — même raison que `daily_scans_day` dans le rollback de 20260822 :
-- une colonne en trop ne gêne personne, et la garder permet de rejouer la
-- migration sans repasser par un ALTER TABLE. Leur verrou dans
-- `prevent_tier_tampering` est en revanche retiré ci-dessous, sinon un client
-- qui les écrirait recevrait une erreur pour des colonnes devenues sans usage.
--
-- ⚠️ Les crédits offerts non consommés sont perdus à la seconde où ce fichier
-- passe : le trigger cesse de lire `welcome_credits`, et rien ne les reverse
-- dans `extra_scan_credits`. Le faire serait pire — les crédits achetés
-- n'expirent pas, et un cadeau périmé y deviendrait perpétuel. Si le parc en
-- porte encore beaucoup, verser la compensation à la main AVANT de dérouler :
--   update profiles set extra_scan_credits = extra_scan_credits + welcome_credits
--    where welcome_credits > 0 and welcome_credits_expires_at > now();
-- (nécessite set_config('app.bypass_tier_check','on',false) dans la session)
--
-- `welcome_grants` est conservée elle aussi : la détruire rendrait tout le parc
-- éligible à un second cadeau au moindre rejeu de la migration.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. L'octroi disparaît
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.grant_welcome_credits(text);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. prevent_tier_tampering — retour à la liste de 20260822
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.prevent_tier_tampering()
returns trigger
language plpgsql
as $$
begin
  if old.is_admin is distinct from new.is_admin then
    raise exception 'is_admin is read-only from client';
  end if;

  if current_setting('app.bypass_tier_check', true) = 'on' then
    return new;
  end if;

  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if old.subscription_tier is distinct from new.subscription_tier then
    raise exception 'subscription_tier is read-only from client';
  end if;
  if old.extra_scan_credits is distinct from new.extra_scan_credits then
    raise exception 'extra_scan_credits is read-only from client';
  end if;
  if old.daily_scans_count is distinct from new.daily_scans_count then
    raise exception 'daily_scans_count is read-only from client';
  end if;
  if old.daily_scans_day is distinct from new.daily_scans_day then
    raise exception 'daily_scans_day is read-only from client';
  end if;
  if old.last_reset_date is distinct from new.last_reset_date then
    raise exception 'last_reset_date is read-only from client';
  end if;

  if old.subscription_status is distinct from new.subscription_status then
    raise exception 'subscription_status is read-only from client';
  end if;
  if old.subscription_expires_at is distinct from new.subscription_expires_at then
    raise exception 'subscription_expires_at is read-only from client';
  end if;
  if old.subscription_product_id is distinct from new.subscription_product_id then
    raise exception 'subscription_product_id is read-only from client';
  end if;

  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. enforce_scan_quota — retour au pool unique
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  daily_limit int;    -- NULL = illimité (premium)
  credits     int;
  used        int;
  stored_day  timestamptz;
  day_start   timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return null;
  end if;

  day_start := public.user_day_start(new.user_id);

  if new.created_at < day_start then
    return null;
  end if;

  select case
           when coalesce(subscription_tier, 'free') <> 'free'
                and subscription_expires_at is not null
                and subscription_expires_at < now()
                and not (
                  subscription_status = 'in_grace_period'
                  and subscription_expires_at > now() - interval '16 days'
                )
             then 'free'
           else coalesce(subscription_tier, 'free')
         end,
         coalesce(extra_scan_credits, 0),
         coalesce(daily_scans_count, 0),
         daily_scans_day
    into v_tier, credits, used, stored_day
    from public.profiles
    where id = new.user_id
    for update;

  select pl.daily_scans into daily_limit
    from public.plan_limits pl
    where pl.tier = v_tier;
  if not found then
    select pl.daily_scans into daily_limit
      from public.plan_limits pl
      where pl.tier = 'free';
  end if;

  if stored_day is distinct from day_start then
    used := 0;
  end if;

  perform set_config('app.bypass_tier_check', 'on', true);

  if daily_limit is not null and used >= daily_limit then
    if credits <= 0 then
      raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
    end if;
    update public.profiles
       set extra_scan_credits = credits - 1,
           daily_scans_count  = used + 1,
           daily_scans_day    = day_start
     where id = new.user_id;
    return null;
  end if;

  update public.profiles
     set daily_scans_count = used + 1,
         daily_scans_day   = day_start
   where id = new.user_id;

  return null;
end;
$$;
