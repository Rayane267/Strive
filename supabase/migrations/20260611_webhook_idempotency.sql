-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotence webhook RevenueCat — déduplication par event.id
-- ═══════════════════════════════════════════════════════════════════════════
-- RevenueCat rejoue un webhook s'il ne reçoit pas de 200 à temps (timeout,
-- cold start). Sans déduplication, un INITIAL_PURCHASE de consumable rejoué
-- crédite les scans en double. Chaque event RC porte un `id` unique → on le
-- mémorise et on ignore les replays, atomiquement (même transaction que
-- l'application de l'event).
--
-- p_event_id est optionnel (default null) : un appel sans id (anciens
-- déploiements de l'edge function, tests SQL manuels) garde l'ancien
-- comportement non-dédupliqué.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.processed_webhook_events (
  event_id    text primary key,
  user_id     uuid,
  event_type  text,
  created_at  timestamptz not null default now()
);

-- Purge éventuelle : les replays RC arrivent dans les heures qui suivent,
-- garder 90 jours est largement suffisant.
create index if not exists idx_processed_webhook_events_created
  on public.processed_webhook_events (created_at);

alter table public.processed_webhook_events enable row level security;
-- Aucune policy → invisible et inaccessible aux clients ; service_role bypasse.


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
      'status',     p_status,
      'event_id',   p_event_id
    )
  );
end;
$$;

-- L'ancienne signature 5-args reste en place (CREATE OR REPLACE ne la touche
-- pas : la nouvelle a 6 args). On la drop pour éviter toute ambiguïté PostgREST.
drop function if exists public.apply_revenuecat_event(uuid, text, text, timestamptz, text);

revoke execute on function public.apply_revenuecat_event(uuid, text, text, timestamptz, text, text) from public;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Premier appel avec event_id → crédits appliqués :
--    select apply_revenuecat_event('<UUID>', 'NON_RENEWING_PURCHASE',
--      'strive_scan_pack_m', null, null, 'evt-test-1');
--    → extra_scan_credits +5
--
-- 2. Replay identique → no-op :
--    (même appel) → extra_scan_credits inchangé, 1 seule ligne dans
--    processed_webhook_events
--
-- 3. Sans event_id (compat) :
--    select apply_revenuecat_event('<UUID>', 'RENEWAL', 'strive_plus_monthly',
--      now() + interval '1 month', 'active', null);
--    → appliqué normalement, rien dans processed_webhook_events
