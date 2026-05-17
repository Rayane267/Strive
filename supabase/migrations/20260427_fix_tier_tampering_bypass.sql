-- ═══════════════════════════════════════════════════════════════════════════
-- Fix : permettre à apply_revenuecat_event de modifier subscription_tier
-- ═══════════════════════════════════════════════════════════════════════════
-- Problème : le trigger prevent_tier_tampering bloque l'UPDATE même quand il
-- vient de notre RPC SECURITY DEFINER, car current_setting('request.jwt.claim.role')
-- ne renvoie pas toujours 'service_role' selon le contexte d'appel.
--
-- Solution : la RPC pose un flag GUC local (visible uniquement dans la même
-- transaction grâce au paramètre `is_local = true`), et le trigger bypass
-- quand ce flag est présent. Sécurité préservée : un client PostgREST normal
-- n'a aucun moyen de set ce GUC.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── Trigger mis à jour : bypass via flag interne ───
create or replace function public.prevent_tier_tampering()
returns trigger
language plpgsql
as $$
begin
  -- Bypass 1 : appelé par notre RPC SECURITY DEFINER
  if current_setting('app.bypass_tier_check', true) = 'on' then
    return new;
  end if;

  -- Bypass 2 : service_role (kept pour compat)
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

  return new;
end;
$$;


-- ─── RPC mise à jour : pose le flag avant les UPDATE sensibles ───
create or replace function public.apply_revenuecat_event(
  p_user_id     uuid,
  p_event_type  text,
  p_product_id  text,
  p_expires_at  timestamptz default null,
  p_status      text default null
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

    elsif p_event_type in ('EXPIRATION', 'CANCELLATION', 'BILLING_ISSUE') then
      update public.profiles
        set subscription_tier       = case
          when p_event_type = 'EXPIRATION' then 'free'
          else subscription_tier
        end,
            subscription_status     = coalesce(p_status,
              case p_event_type
                when 'EXPIRATION'    then 'expired'
                when 'CANCELLATION'  then 'cancelled'
                when 'BILLING_ISSUE' then 'in_grace_period'
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
      'status',     p_status
    )
  );
end;
$$;

revoke execute on function public.apply_revenuecat_event(uuid, text, text, timestamptz, text) from public;
