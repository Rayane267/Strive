-- Rollback de 20260822_scan_quota_on_profile.sql
--
-- NE RECRÉE PAS `scan_ledger` ni `quota_remaining_scans()`, que la migration
-- supprime : ce rollback ramène au comptage sur `rides`, qui ne s'en sert pas.
-- Pour retrouver le registre, rejouer 20260820_scan_ledger.sql — mais lire
-- d'abord pourquoi il est caduc (en-tête de 20260822).
--
-- Rend le quota au comptage sur `rides` (état de 20260811_quota_day_window_restore).
-- ⚠️ Le trou revient avec : « Supprimer mon historique » rendra de nouveau des
-- scans aux tiers limités.
--
-- `profiles.daily_scans_day` n'est PAS supprimée — une colonne en trop ne gêne
-- personne, et la garder permet de rejouer la migration sans repasser par un
-- ALTER TABLE. Son verrou dans `prevent_tier_tampering` est en revanche retiré
-- ci-dessous, sinon un client qui l'écrirait recevrait une erreur pour une
-- colonne devenue sans usage.

create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  daily_limit int;
  count_today int;
  credits     int;
  day_start   timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
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
         coalesce(extra_scan_credits, 0)
    into v_tier, credits
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

  if daily_limit is null then
    return new;
  end if;

  day_start := public.user_day_start(new.user_id);

  select count(*) into count_today
    from public.rides
    where user_id = new.user_id
      and created_at >= day_start;

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

drop trigger if exists check_scan_quota on public.rides;
create trigger check_scan_quota
  before insert on public.rides
  for each row execute function public.enforce_scan_quota();

-- Retire le verrou sur `daily_scans_day` (recopie de 20260811_lock_privilege_columns).
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
