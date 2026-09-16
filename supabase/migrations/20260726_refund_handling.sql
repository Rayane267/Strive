-- ═══════════════════════════════════════════════════════════════════════════
-- REFUND : révocation immédiate
-- ═══════════════════════════════════════════════════════════════════════════
-- RevenueCat envoie REFUND quand Apple/Google rembourse un achat. L'event
-- n'était traité ni par statusForEvent (edge function) ni par la RPC : il
-- n'atterrissait dans aucune branche → no-op, seule la ligne d'audit était
-- écrite. Un utilisateur remboursé gardait donc son accès jusqu'à la date
-- d'expiration initiale (jusqu'à un an pour un abo annuel), et un pack de scans
-- remboursé laissait ses crédits.
--
-- Un remboursement annule la transaction : l'accès est coupé tout de suite,
-- contrairement à CANCELLATION (résiliation, où la période payée reste due).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── Nouveau statut 'refunded' (distinct de 'expired' pour le support) ──────
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and conname = 'profile_subscription_status_check'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profile_subscription_status_check check (
    subscription_status is null
    or subscription_status in ('active', 'in_grace_period', 'expired', 'cancelled', 'paused', 'refunded')
  );


-- ─── apply_revenuecat_event : branche REFUND (abos + consommables) ──────────
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

    -- Pack remboursé : on reprend les crédits. greatest(...,0) car ils ont pu
    -- être consommés entre l'achat et le remboursement — on ne descend jamais
    -- sous zéro (ça bloquerait des scans déjà payés par un autre pack).
    elsif p_event_type = 'REFUND' then
      update public.profiles
        set extra_scan_credits = greatest(coalesce(extra_scan_credits, 0) - v_product.scan_credits, 0)
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

    -- Coupure immédiate. REFUND rejoint EXPIRATION / SUBSCRIPTION_PAUSED : le
    -- tier retombe à free sur-le-champ. En plus, REFUND ramène l'expiration à
    -- maintenant — sans ça, la garde côté client (getEffectivePlanTier) et
    -- côté serveur (enforce_scan_quota) continueraient de voir une date future
    -- et rouvriraient l'accès au prochain event.
    elsif p_event_type in ('EXPIRATION', 'CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'REFUND') then
      update public.profiles
        set subscription_tier       = case
              when p_event_type in ('EXPIRATION', 'SUBSCRIPTION_PAUSED', 'REFUND') then 'free'
              else subscription_tier
            end,
            subscription_status     = coalesce(p_status,
              case p_event_type
                when 'EXPIRATION'          then 'expired'
                when 'CANCELLATION'        then 'cancelled'
                when 'BILLING_ISSUE'       then 'in_grace_period'
                when 'SUBSCRIPTION_PAUSED' then 'paused'
                when 'REFUND'              then 'refunded'
              end),
            subscription_expires_at = case
              when p_event_type = 'REFUND' then least(coalesce(p_expires_at, now()), now())
              else coalesce(p_expires_at, subscription_expires_at)
            end
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
