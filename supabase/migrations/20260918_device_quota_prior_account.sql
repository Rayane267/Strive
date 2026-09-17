-- ═══════════════════════════════════════════════════════════════════════════
-- Plafond d'appareil : ne plus accuser « un autre compte » à tort
-- ═══════════════════════════════════════════════════════════════════════════
--
-- LA RÈGLE NE CHANGE PAS. Un compte recréé après une suppression est un compte
-- NORMAL — quota journalier plein, aucune punition, aucun délai. Seule sa
-- consommation de scans est retenue, par appareil : c'est ce qui empêche de
-- rejouer les trois scans gratuits en supprimant son compte. Ce refus-là reste.
--
-- CE QUI CHANGE, C'EST CE QU'ON LUI DIT. Le message affiché aujourd'hui est :
--
--   « Les 3 scans gratuits de ce téléphone ont déjà été utilisés aujourd'hui,
--     AVEC UN AUTRE COMPTE. »
--
-- Or pour un chauffeur qui vient de supprimer puis recréer son compte, c'est
-- faux : l'autre compte, c'était le sien, il y a dix minutes. Le registre ne
-- pouvait pas faire la différence — `delete_account` anonymise la ligne
-- (`user_id → NULL`), donc `own_used` retombe à zéro et l'excédent ressemble à
-- celui d'un tiers.
--
-- La différence est pourtant lisible dans la table. Une ligne anonyme est,
-- par construction, celle d'un compte SUPPRIMÉ sur cet appareil ; une ligne
-- avec un `user_id` vivant et différent est celle d'un tiers bien réel. Deux
-- situations, deux phrases :
--
--   • excédent porté par un compte vivant   → « avec un autre compte »
--   • excédent porté par des lignes anonymes → « sur ce téléphone aujourd'hui »
--
-- La seconde n'accuse personne et décrit exactement ce qui s'est passé. Le
-- chauffeur qui a recréé son compte comprend enfin pourquoi son compteur neuf
-- ne lui rend pas ses scans — au lieu de croire à un bug ou à un vol de compte.
--
-- Le motif porte un nom SANS PRÉFIXE COMMUN avec `device_scan_quota_exceeded` :
-- le client teste les messages par `includes()`, et un nom qui contiendrait
-- l'autre ferait toujours gagner le premier test.
--
-- Tout le reste de `enforce_scan_quota` est recopié sans changement depuis
-- 20260917_device_scan_ledger.sql — `create or replace` remplace le corps
-- entier. Les choix d'origine (fenêtre de journée, tier effectif, FOR UPDATE,
-- ordre de consommation des pools) sont documentés là-bas et dans
-- 20260830_welcome_credits.sql.

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
  v_device    text;
  v_day       date;
  device_used int;
  own_used    int;
  -- Scans du jour portés par un compte ENCORE VIVANT et différent du nôtre.
  -- C'est le seul cas où « un autre compte » est une phrase vraie.
  live_other  int;
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

  if welcome_exp is null or welcome_exp <= now() then
    welcome := 0;
  end if;

  if stored_day is distinct from day_start then
    used := 0;
  end if;

  -- ── Plafond d'appareil ───────────────────────────────────────────────────
  -- Avant les pools du compte, et pour les comptes GRATUITS uniquement. Un
  -- appareil qui a déjà épuisé le quota gratuit du jour ne le regagne pas en
  -- changeant de compte — ni en supprimant celui qu'il avait.
  --
  -- L'absence de device_id ne bloque RIEN : un client trop ancien pour envoyer
  -- l'en-tête doit continuer à scanner. Le plafond du compte, lui, s'applique
  -- toujours — on ne troque pas une protection contre l'autre.
  v_device := public.request_device_id();
  v_day := day_start::date;

  if v_device is not null and v_tier = 'free' and daily_limit is not null then
    select coalesce(sum(scans), 0),
           coalesce(sum(scans) filter (where user_id = new.user_id), 0),
           coalesce(sum(scans) filter (
             where user_id is not null and user_id <> new.user_id
           ), 0)
      into device_used, own_used, live_other
      from public.device_scan_ledger
     where device_id = v_device
       and day = v_day;

    -- `device_used > own_used` : les scans du jour ne viennent pas tous de ce
    -- compte-ci. Sans ce test, un chauffeur seul au bout de ses trois scans
    -- recevrait un message d'appareil alors que son propre plafond suffit à le
    -- refuser, avec le bon motif.
    --
    -- Les crédits achetés et le pool de bienvenue passent OUTRE ce plafond : ils
    -- appartiennent au compte, ils ont été payés ou offerts une seule fois par
    -- appareil (`welcome_grants`), et rien ne se farme en les dépensant.
    if device_used >= daily_limit
       and device_used > own_used
       and welcome <= 0
       and credits <= 0 then
      if live_other > 0 then
        raise exception 'device_scan_quota_exceeded'
          using errcode = 'P0001';
      else
        -- Excédent entièrement porté par des lignes anonymes : des comptes
        -- supprimés sur ce téléphone. Très probablement le sien, juste avant.
        raise exception 'prior_account_scans_on_device'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  perform set_config('app.bypass_tier_check', 'on', true);

  if daily_limit is not null and used >= daily_limit then
    if welcome > 0 then
      update public.profiles
         set welcome_credits   = welcome - 1,
             daily_scans_count = used + 1,
             daily_scans_day   = day_start
       where id = new.user_id;
      perform public.record_device_scan(v_device, v_day, new.user_id);
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
    perform public.record_device_scan(v_device, v_day, new.user_id);
    return null;
  end if;

  update public.profiles
     set daily_scans_count = used + 1,
         daily_scans_day   = day_start
   where id = new.user_id;

  perform public.record_device_scan(v_device, v_day, new.user_id);

  return null;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Compte recréé (lignes anonymes uniquement) — trois scans consommés la veille
-- de la suppression, même journée :
--   insert into public.device_scan_ledger (device_id, day, user_id, scans)
--   values ('test-device-1234567890', current_date, null, 3);
--   → le 1er scan du compte recréé lève `prior_account_scans_on_device`
--
-- Deux comptes vivants sur le même téléphone :
--   insert into public.device_scan_ledger (device_id, day, user_id, scans)
--   values ('test-device-1234567890', current_date, '<autre uuid vivant>', 3);
--   → lève `device_scan_quota_exceeded`
--
--   delete from public.device_scan_ledger where device_id = 'test-device-1234567890';
