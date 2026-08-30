-- ═══════════════════════════════════════════════════════════════════════════
-- Crédits de bienvenue : 30 scans offerts, une fois par appareil, 14 jours
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI. Le gratuit à 3 scans/jour est un rationnement permanent : le
-- chauffeur ne vit jamais Strive tel qu'il est censé être utilisé. 30 scans
-- d'affilée, c'est 2 à 3 vacations complètes sans compter — et c'est la
-- retombée à 3/jour ensuite, ressentie chaque jour, qui vend l'abonnement.
-- Offrir puis retirer convertit mieux que n'avoir jamais donné.
--
-- POURQUOI UNE TABLE ET PAS UN BOOLÉEN SUR LE PROFIL. Le cadeau est indexé sur
-- l'APPAREIL, pas sur le compte : un compte se recrée en 90 secondes avec une
-- nouvelle adresse Gmail. `welcome_grants` a le device_id en clé primaire, donc
-- `on conflict do nothing` rend l'octroi naturellement idempotent — même esprit
-- que `scan_ledger` (20260820) avant qu'il ne devienne caduc.
--
-- Le garde-fou existant reste la première ligne de défense : 3 inscriptions par
-- appareil sur 60 jours (`check_and_register_device_signup`, 20260727). Le pire
-- cas est donc borné à 30 scans offerts par appareil, pas 90 : les 2e et 3e
-- comptes d'un même téléphone (revente, compte pro puis perso) tapent dans
-- `welcome_grants` et repartent les mains vides.
--
-- POURQUOI UN POOL SÉPARÉ DE `extra_scan_credits`. Les deux se ressemblent mais
-- ne vieillissent pas pareil : un crédit ACHETÉ ne doit jamais expirer, un
-- crédit OFFERT doit. Les mélanger dans une colonne unique rendrait toute date
-- d'expiration fausse le jour où les packs de scans se vendront. Rien ne les
-- vend aujourd'hui — `extra_scan_credits` n'a aucun écrivain en production, et
-- `ShopScreen.tsx` n'est enregistré dans aucun navigateur. C'est précisément
-- pour ça que la séparation se fait MAINTENANT : elle est gratuite tant que la
-- colonne est vide, et impossible à démêler une fois les deux mélangées.
--
-- ORDRE DE CONSOMMATION : quota journalier → crédits de bienvenue → crédits
-- achetés. Le quota d'abord parce qu'il se régénère (les 30 durent donc plus de
-- jours calendaires, ce qui installe l'habitude), le cadeau avant l'achat parce
-- que c'est lui qui périme.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Les deux colonnes du pool offert
-- ═══════════════════════════════════════════════════════════════════════════
-- `welcome_credits_expires_at` porte deux informations d'un coup : la date de
-- péremption, et le fait que ce compte a DÉJÀ reçu son cadeau (non NULL = servi).
-- C'est ce qui permet de ne pas re-créditer un même compte installé sur deux
-- téléphones sans tenir une seconde table côté utilisateur.
alter table public.profiles
  add column if not exists welcome_credits            int not null default 0,
  add column if not exists welcome_credits_expires_at timestamptz;

alter table public.profiles
  drop constraint if exists profile_welcome_credits_check;
alter table public.profiles
  add constraint profile_welcome_credits_check check (welcome_credits >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. prevent_tier_tampering : les deux colonnes rejoignent le verrou
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans ça la faille est béante : `welcome_credits` est écrivable par le client
-- via la policy update de `profiles`, donc n'importe qui se donne 10 000 scans.
-- La date compte autant que le montant — la repousser ressusciterait un pool
-- périmé.
--
-- Recopie intégrale de 20260822_scan_quota_on_profile.sql, deux lignes en plus.
-- `is_admin` reste testé AVANT les bypass, pour la raison qui y est donnée.
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
  if old.welcome_credits is distinct from new.welcome_credits then
    raise exception 'welcome_credits is read-only from client';
  end if;
  if old.welcome_credits_expires_at is distinct from new.welcome_credits_expires_at then
    raise exception 'welcome_credits_expires_at is read-only from client';
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
-- 3. welcome_grants : un appareil, un cadeau, à vie
-- ═══════════════════════════════════════════════════════════════════════════
-- Pas de fenêtre glissante ici, contrairement à `device_signups` : le cadeau ne
-- se rouvre jamais. Un chauffeur qui change réellement de téléphone au bout de
-- deux ans le retouchera — c'est assumé, il n'y a pas de signal qui distingue ce
-- cas d'un reset volontaire, et la fraude coûte 7 centimes.
create table if not exists public.welcome_grants (
  device_id  text        primary key,
  -- ON DELETE SET NULL et pas CASCADE : la suppression du compte (RGPD) ne doit
  -- pas rendre l'appareil éligible à nouveau. La ligne survit, anonyme.
  user_id    uuid        references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

alter table public.welcome_grants enable row level security;
-- Aucune policy → seul service_role / SECURITY DEFINER lit/écrit. Le chauffeur
-- n'a rien à y lire : son solde est sur son profil.


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. grant_welcome_credits — l'octroi, appelé en fin d'onboarding
-- ═══════════════════════════════════════════════════════════════════════════
-- Ne peut PAS vivre dans `check_and_register_device_signup` : celle-là tourne en
-- `anon` AVANT `auth.signUp()`, donc sans `auth.uid()` ni ligne de profil à
-- créditer. D'où une RPC distincte, authentifiée, appelée plus tard.
--
-- Ne raise jamais sur un refus : « déjà servi » est un cas NORMAL (réinstallation,
-- second compte du foyer) et non une erreur. Le client lit `granted` et n'a rien
-- à rattraper. Seules les entrées invalides lèvent.
create or replace function public.grant_welcome_credits(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Les deux seuls paramètres du cadeau. Modifiables par `create or replace`
  -- sans redéployer l'app — comme `plan_limits` pour les quotas.
  c_amount constant int := 30;
  c_days   constant int := 14;
  uid           uuid;
  v_already     boolean;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;
  -- Même plancher que check_and_register_device_signup : un device_id court est
  -- un client cassé ou forgé, pas un appareil.
  if p_device_id is null or length(p_device_id) < 16 then
    raise exception 'invalid_device_id' using errcode = 'P0001';
  end if;

  -- Garde compte. Non-NULL = ce profil a déjà été servi, quelle qu'en soit la
  -- date. Couvre le même compte réinstallé sur un second téléphone.
  select welcome_credits_expires_at is not null
    into v_already
    from public.profiles
   where id = uid;

  if v_already is null then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;
  if v_already then
    return jsonb_build_object('granted', false, 'reason', 'already_granted');
  end if;

  -- Garde appareil. FOUND passe à false si la clé existait déjà : c'est le
  -- verrou anti-farming, et il est atomique.
  insert into public.welcome_grants (device_id, user_id)
    values (p_device_id, uid)
    on conflict (device_id) do nothing;

  if not found then
    return jsonb_build_object('granted', false, 'reason', 'device_already_granted');
  end if;

  -- SECURITY DEFINER ne suffit pas : `prevent_tier_tampering` teste le rôle JWT
  -- de l'appelant, qui reste `authenticated`. Le bypass est transactionnel.
  perform set_config('app.bypass_tier_check', 'on', true);

  update public.profiles
     set welcome_credits            = c_amount,
         welcome_credits_expires_at = now() + (c_days || ' days')::interval
   where id = uid;

  insert into public.audit_log (user_id, action, details)
    values (uid, 'welcome_credits_granted',
            jsonb_build_object('amount', c_amount, 'days', c_days));

  return jsonb_build_object(
    'granted', true,
    'amount',  c_amount,
    'expires_in_days', c_days
  );
end;
$$;

revoke execute on function public.grant_welcome_credits(text) from public;
-- Pas `anon` : l'octroi crédite un profil, il exige un utilisateur.
grant execute on function public.grant_welcome_credits(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. enforce_scan_quota : le pool offert s'intercale entre quota et achats
-- ═══════════════════════════════════════════════════════════════════════════
-- Recopie de 20260822_scan_quota_on_profile.sql. Seul le bloc de dépassement
-- change ; tout le reste (fenêtre de journée, tier effectif, FOR UPDATE, rejeu
-- du journal natif) est inchangé et documenté là-bas.
--
-- Un pool offert PÉRIMÉ n'est pas remis à zéro ici : ce serait une écriture sur
-- le chemin chaud du scan pour rien. La colonne garde sa valeur, la date la rend
-- inerte, et l'app applique la même règle pour l'affichage.
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
  welcome     int;
  welcome_exp timestamptz;
  used        int;
  stored_day  timestamptz;
  day_start   timestamptz;
begin
  -- Valeur de retour ignorée sur un AFTER : `null` partout, y compris sur les
  -- sorties anticipées.
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return null;
  end if;

  day_start := public.user_day_start(new.user_id);

  -- Une course datée d'une journée ÉCOULÉE ne consomme pas le quota du jour.
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
         coalesce(welcome_credits, 0),
         welcome_credits_expires_at,
         coalesce(daily_scans_count, 0),
         daily_scans_day
    into v_tier, credits, welcome, welcome_exp, used, stored_day
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

  -- Péremption : passé la date, le pool offert ne vaut plus rien. Testé ici
  -- plutôt qu'en base pour que la règle soit au même endroit que sa consommation.
  if welcome_exp is null or welcome_exp <= now() then
    welcome := 0;
  end if;

  if stored_day is distinct from day_start then
    used := 0;
  end if;

  perform set_config('app.bypass_tier_check', 'on', true);

  -- Illimité : on compte quand même. Une rétrogradation vers free en cours de
  -- journée ne doit pas repartir d'un compteur vierge.
  if daily_limit is not null and used >= daily_limit then
    -- Cadeau d'abord : c'est le seul des deux pools qui périme.
    if welcome > 0 then
      update public.profiles
         set welcome_credits   = welcome - 1,
             daily_scans_count = used + 1,
             daily_scans_day   = day_start
       where id = new.user_id;
      return null;
    end if;

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


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Octroi puis rejeu sur le même appareil :
--    select grant_welcome_credits('aaaaaaaaaaaaaaaa-test');
--    → {"granted": true, "amount": 30, "expires_in_days": 14}
--    select grant_welcome_credits('aaaaaaaaaaaaaaaa-test');
--    → {"granted": false, "reason": "already_granted"}     (garde compte)
--
-- 2. Même appareil, autre compte (se connecter avec un 2e user) :
--    select grant_welcome_credits('aaaaaaaaaaaaaaaa-test');
--    → {"granted": false, "reason": "device_already_granted"}
--
-- 3. Device ID trop court rejeté :
--    select grant_welcome_credits('short');   → ERROR: invalid_device_id
--
-- 4. La colonne reste verrouillée côté client (depuis l'app, pas psql) :
--    update profiles set welcome_credits = 9999 where id = auth.uid();
--    → ERROR: welcome_credits is read-only from client
--
-- 5. Consommation dans le bon ordre — compte free (3/jour) avec 30 offerts :
--    scans 1-3   → daily_scans_count monte, welcome_credits reste à 30
--    scans 4-33  → welcome_credits descend 30 → 0
--    scan 34     → ERROR: daily_scan_quota_exceeded (si extra_scan_credits = 0)
--
-- 6. Péremption : reculer la date à la main puis scanner au-delà du quota
--    update profiles set welcome_credits_expires_at = now() - interval '1 day' …
--    → ERROR: daily_scan_quota_exceeded, sans que welcome_credits ait bougé
