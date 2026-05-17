-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription schema — colonnes profiles + table de mapping produits
-- ═══════════════════════════════════════════════════════════════════════════
-- À exécuter APRÈS 20260425_security_hardening.sql.
-- Architecture pensée pour absorber les changements de pricing/packs sans
-- redéploiement de l'app : la table subscription_products sert de lookup
-- pour le webhook RevenueCat. Modifier un pack = UPDATE en DB.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Colonnes RevenueCat sur profiles
-- ═══════════════════════════════════════════════════════════════════════════
-- revenuecat_user_id : app_user_id renvoyé par RevenueCat (alias d'auth.uid)
-- subscription_expires_at : fin de période courante (renouvelée automatiquement)
-- subscription_status : active | in_grace_period | expired | cancelled | paused
-- subscription_product_id : SKU actif (pour debug / affichage UI éventuel)

alter table public.profiles
  add column if not exists revenuecat_user_id      text,
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists subscription_status     text,
  add column if not exists subscription_product_id text;

create index if not exists idx_profiles_revenuecat_user
  on public.profiles (revenuecat_user_id);

-- Drop puis recreate la CHECK status (idempotent, supporte les renames futurs)
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
    or subscription_status in ('active', 'in_grace_period', 'expired', 'cancelled', 'paused')
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Table subscription_products — lookup SKU → entitlement / crédits
-- ═══════════════════════════════════════════════════════════════════════════
-- Le webhook RevenueCat lit cette table à chaque event :
--   - product_type = 'subscription' → met à jour profiles.subscription_tier
--   - product_type = 'consumable'   → incrémente profiles.extra_scan_credits
--
-- Modifier la composition d'un pack ou le tier d'un SKU = simple UPDATE,
-- pas besoin de redéployer l'edge function ni l'app.

create table if not exists public.subscription_products (
  product_id    text primary key,
  product_type  text not null check (product_type in ('subscription', 'consumable')),
  tier          text check (tier is null or tier in ('plus', 'premium')),
  scan_credits  int  not null default 0 check (scan_credits >= 0),
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Contraintes métier : subscription a forcément un tier, consumable a forcément des crédits
  constraint subscription_has_tier check (
    product_type <> 'subscription' or tier is not null
  ),
  constraint consumable_has_credits check (
    product_type <> 'consumable' or scan_credits > 0
  )
);

-- Trigger updated_at
create or replace function public.touch_subscription_products()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_subscription_products on public.subscription_products;
create trigger touch_subscription_products
  before update on public.subscription_products
  for each row execute function public.touch_subscription_products();

-- RLS : lecture autorisée à tous les authentifiés (l'app peut afficher la
-- liste des packs disponibles). Écriture réservée au service_role.
alter table public.subscription_products enable row level security;

drop policy if exists "subscription_products_read" on public.subscription_products;
create policy "subscription_products_read"
  on public.subscription_products for select
  to authenticated
  using (is_active = true);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Seed initial — SKU recommandés (génériques, prix-agnostiques)
-- ═══════════════════════════════════════════════════════════════════════════
-- À synchroniser avec App Store Connect / Play Console / RevenueCat.
-- Tu peux décommenter / adapter selon ce que tu lances en v1.

insert into public.subscription_products (product_id, product_type, tier, scan_credits, notes)
values
  ('strive_plus_monthly',     'subscription', 'plus',    0, 'Plus mensuel'),
  ('strive_plus_yearly',      'subscription', 'plus',    0, 'Plus annuel'),
  ('strive_premium_monthly',  'subscription', 'premium', 0, 'Premium mensuel'),
  ('strive_premium_yearly',   'subscription', 'premium', 0, 'Premium annuel'),
  ('strive_scan_pack_xs',     'consumable',   null,      1, 'Pack 1 scan'),
  ('strive_scan_pack_s',      'consumable',   null,      3, 'Pack 3 scans'),
  ('strive_scan_pack_m',      'consumable',   null,      5, 'Pack 5 scans'),
  ('strive_scan_pack_l',      'consumable',   null,     10, 'Pack 10 scans')
on conflict (product_id) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RPC apply_revenuecat_event — appelée par l'edge function webhook
-- ═══════════════════════════════════════════════════════════════════════════
-- Centralise la logique d'application d'un event RevenueCat côté DB.
-- L'edge function n'a qu'à transmettre (user_id, event_type, product_id,
-- expires_at, status) → la DB fait le lookup et applique le bon update.
-- SECURITY DEFINER → bypass le trigger anti-tampering (logique service).

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

  select * into v_product
    from public.subscription_products
    where product_id = p_product_id
      and is_active = true;

  if not found then
    raise warning 'Unknown or inactive product_id: %', p_product_id;
    return;
  end if;

  if v_product.product_type = 'consumable' then
    -- Crédite uniquement sur achat initial / non-renouvelable
    if p_event_type in ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE') then
      update public.profiles
        set extra_scan_credits = coalesce(extra_scan_credits, 0) + v_product.scan_credits
        where id = p_user_id;
    end if;

  elsif v_product.product_type = 'subscription' then
    -- Activation : upgrade tier + statut + expiration
    if p_event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION') then
      update public.profiles
        set subscription_tier       = v_product.tier,
            subscription_product_id = p_product_id,
            subscription_expires_at = p_expires_at,
            subscription_status     = coalesce(p_status, 'active')
        where id = p_user_id;

    -- Désactivation : retour à free
    elsif p_event_type in ('EXPIRATION', 'CANCELLATION', 'BILLING_ISSUE') then
      update public.profiles
        set subscription_tier       = case
          when p_event_type = 'EXPIRATION' then 'free'
          else subscription_tier  -- CANCELLATION / BILLING_ISSUE : on garde le tier jusqu'à expires_at
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

  -- Audit
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
-- Pas de grant à authenticated → seul service_role peut appeler (depuis l'edge function)


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Vérifier le seed :
--    select * from subscription_products order by product_type, tier, scan_credits;
--
-- 2. Simuler un achat de subscription Plus mensuel (en service_role / SQL Editor) :
--    select apply_revenuecat_event(
--      '<UUID_USER>',
--      'INITIAL_PURCHASE',
--      'strive_plus_monthly',
--      now() + interval '1 month',
--      'active'
--    );
--    select id, subscription_tier, subscription_status, subscription_expires_at
--      from profiles where id = '<UUID_USER>';
--
-- 3. Simuler un achat de pack 5 scans :
--    select apply_revenuecat_event(
--      '<UUID_USER>', 'NON_RENEWING_PURCHASE', 'strive_scan_pack_m', null, null
--    );
--    → extra_scan_credits doit avoir augmenté de 5
