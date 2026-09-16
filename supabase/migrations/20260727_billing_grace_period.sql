-- ═══════════════════════════════════════════════════════════════════════════
-- Période de grâce facturation
-- ═══════════════════════════════════════════════════════════════════════════
-- Quand un paiement échoue, Apple ne coupe pas l'abonnement : il réessaie la
-- carte pendant plusieurs jours (jusqu'à 16 avec la Billing Grace Period activée
-- dans App Store Connect) et envoie un BILLING_ISSUE. apply_revenuecat_event
-- conserve déjà le tier et passe le statut à 'in_grace_period' — mais
-- enforce_scan_quota ne lisait que la date : l'abonné retombait au quota free
-- pendant qu'Apple était encore en train de réessayer son paiement.
--
-- On aligne le serveur sur getEffectivePlanTier : le tier est conservé tant que
-- le statut est 'in_grace_period' ET que l'expiration date de moins de 16 jours.
-- Le plafond est le garde-fou : si l'event EXPIRATION se perdait, l'accès ne
-- resterait pas ouvert indéfiniment.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  daily_limit int;
  count_today int;
  credits int;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  -- Tier EFFECTIF : un abo dont l'expiration est passée retombe en 'free', même
  -- si l'event EXPIRATION du webhook a été manqué — sauf pendant la période de
  -- grâce (miroir exact de getEffectivePlanTier / GRACE_PERIOD_DAYS).
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
    from public.profiles where id = new.user_id;

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
