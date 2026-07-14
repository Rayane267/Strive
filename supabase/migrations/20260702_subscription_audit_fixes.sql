-- ═══════════════════════════════════════════════════════════════════════════
-- Audit abonnements — 2 correctifs
-- ═══════════════════════════════════════════════════════════════════════════
--  #2  apply_revenuecat_event : gérer SUBSCRIPTION_PAUSED (Android) → l'abo en
--      pause ne donne plus accès (tier → free, statut → paused). Avant : l'event
--      n'était dans aucune branche → no-op → l'utilisateur gardait son rôle.
--
--  #4  enforce_scan_quota : appliquer la garde d'expiration côté serveur. Avant,
--      la fonction lisait subscription_tier brut → un abo expiré dont l'event
--      EXPIRATION a été raté gardait son quota élevé (premium/plus) à l'insert.
--      On dégrade en 'free' si subscription_expires_at < now(), comme
--      getEffectivePlanTier côté client.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── #2 : apply_revenuecat_event (6 args) + SUBSCRIPTION_PAUSED ─────────────
create or replace function public.apply_revenuecat_event(
  p_user_id     uuid,
  p_event_type  text,
  p_product_id  text,
  p_expires_at  timestamptz default null,
  p_status      text default null,
  p_event_id    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product subscription_products%rowtype;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Déduplication : si l'event a déjà été traité (replay RC), no-op.
  if p_event_id is not null then
    insert into public.processed_webhook_events (event_id, user_id, event_type)
    values (p_event_id, p_user_id, p_event_type)
    on conflict (event_id) do nothing;
    if not found then
      raise notice 'Duplicate webhook event ignored: %', p_event_id;
      return;
    end if;
  end if;

  -- Active le bypass du trigger anti-tampering pour cette transaction
  perform set_config('app.bypass_tier_check', 'on', true);

  select * into v_product
    from public.subscription_products
    where product_id = p_product_id
      and is_active = true;

  if not found then
    raise warning 'Unknown or inactive product_id: %', p_product_id;
    return;
  end if;

  if v_product.product_type = 'consumable' then
    if p_event_type in ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE') then
      update public.profiles
        set extra_scan_credits = coalesce(extra_scan_credits, 0) + v_product.scan_credits
        where id = p_user_id;
    end if;

  elsif v_product.product_type = 'subscription' then
    if p_event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION') then
      update public.profiles
        set subscription_tier       = v_product.tier,
            subscription_product_id = p_product_id,
            subscription_expires_at = p_expires_at,
            subscription_status     = coalesce(p_status, 'active')
        where id = p_user_id;

    -- Désactivation. EXPIRATION et SUBSCRIPTION_PAUSED coupent l'accès (tier
    -- free) ; CANCELLATION / BILLING_ISSUE gardent le tier jusqu'à expires_at.
    elsif p_event_type in ('EXPIRATION', 'CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED') then
      update public.profiles
        set subscription_tier       = case
              when p_event_type in ('EXPIRATION', 'SUBSCRIPTION_PAUSED') then 'free'
              else subscription_tier
            end,
            subscription_status     = coalesce(p_status,
              case p_event_type
                when 'EXPIRATION'         then 'expired'
                when 'CANCELLATION'       then 'cancelled'
                when 'BILLING_ISSUE'      then 'in_grace_period'
                when 'SUBSCRIPTION_PAUSED' then 'paused'
              end),
            subscription_expires_at = coalesce(p_expires_at, subscription_expires_at)
        where id = p_user_id;
    end if;
  end if;

  insert into public.audit_log (user_id, action, details)
  values (
    p_user_id,
    'revenuecat_event',
    jsonb_build_object(
      'event_type', p_event_type,
      'product_id', p_product_id,
      'expires_at', p_expires_at,
      'status',     p_status,
      'event_id',   p_event_id
    )
  );
end;
$$;

revoke execute on function public.apply_revenuecat_event(uuid, text, text, timestamptz, text, text) from public;


-- ─── #4 : enforce_scan_quota + garde d'expiration ──────────────────────────
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
  -- si l'event EXPIRATION du webhook a été manqué (miroir de getEffectivePlanTier).
  select case
           when coalesce(subscription_tier, 'free') <> 'free'
                and subscription_expires_at is not null
                and subscription_expires_at < now()
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

-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS
-- ═══════════════════════════════════════════════════════════════════════════
-- #2 : select apply_revenuecat_event('<UUID>','SUBSCRIPTION_PAUSED',
--        'strive_plus_monthly', null, null, 'evt-pause-1');
--      → subscription_tier = 'free', subscription_status = 'paused'
--
-- #4 : mettre subscription_tier='premium', subscription_expires_at=now()-1h,
--      puis insérer 4+ courses en tant qu'utilisateur → quota free (3) appliqué.
-- ═══════════════════════════════════════════════════════════════════════════
