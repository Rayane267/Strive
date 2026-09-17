-- ═══════════════════════════════════════════════════════════════════════════
-- Quota de scans par APPAREIL — anti-farming par suppression de compte
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI CLOCHAIT. Le quota journalier est porté par le profil
-- (`daily_scans_count`). Supprimer son compte et en recréer un rend donc trois
-- scans gratuits, autant de fois par jour qu'on le veut : `delete_account`
-- emporte le profil et son compteur, et le compte suivant repart à zéro.
--
-- `device_signups` et `welcome_grants` ferment déjà cette porte pour
-- l'inscription et le cadeau de bienvenue, tous deux indexés sur le device_id du
-- Keychain — qui survit à une désinstallation. Le quota de scans restait la
-- dernière ouverte.
--
-- CE QU'ON NE FAIT PAS. Pas de colonne `device_id` sur `rides` : l'identifiant
-- d'appareil n'a rien à faire à côté d'adresses de course, et `device_signups`
-- doit rester la seule table qui le porte en clair. Il arrive ici par l'en-tête
-- HTTP `x-device-id`, que PostgREST expose dans `request.headers` — donc lisible
-- par le trigger, et jamais persisté avec la donnée métier.
--
-- CE QUI RESTE PERMIS. Le plafond d'appareil ne s'applique QU'AUX COMPTES
-- GRATUITS. Un abonné Plus ou Premium ne farme rien : le bloquer parce qu'un
-- autre chauffeur a utilisé ses trois scans sur le même téléphone — un
-- remplaçant, un conjoint, un téléphone de flotte — serait une punition pour un
-- comportement légitime, et il a payé pour ne pas la subir.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Le registre
-- ═══════════════════════════════════════════════════════════════════════════
-- Une ligne par (appareil, jour, compte) et non par (appareil, jour) : le total
-- de l'appareil s'obtient par somme, mais on garde QUI a consommé quoi. C'est ce
-- qui permet de distinguer « tu as épuisé TES scans » de « ce téléphone les a
-- déjà tous utilisés aujourd'hui, avec un autre compte » — deux refus qui
-- appellent deux messages, et dont un seul ressemble à un bug vu du chauffeur.
create table if not exists public.device_scan_ledger (
  device_id text        not null,
  -- Jour du quota, pris sur la journée du chauffeur (`user_day_start`) et non
  -- sur la date UTC : un scan à 1 h du matin appartient à la nuit de travail
  -- précédente, et le compteur du profil le compte déjà ainsi.
  day       date        not null,
  -- ON DELETE SET NULL, même raison que `welcome_grants` : la suppression du
  -- compte (RGPD) ne doit pas effacer la consommation de l'appareil, sinon le
  -- registre se contourne exactement par le geste qu'il est censé couvrir. La
  -- ligne survit, anonyme, et continue de compter.
  user_id   uuid        references auth.users(id) on delete set null,
  scans     int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, day, user_id)
);

-- Le trigger somme les scans d'un appareil pour une journée à chaque insertion :
-- c'est le chemin chaud du scan, il lui faut son index.
create index if not exists device_scan_ledger_device_day_idx
  on public.device_scan_ledger (device_id, day);

alter table public.device_scan_ledger enable row level security;
-- Aucune policy → seul service_role / SECURITY DEFINER y touche. Le chauffeur
-- n'a rien à y lire : son solde est sur son profil, et le total de l'appareil ne
-- le regarde pas — c'est la consommation de quelqu'un d'autre.


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Lecture du device_id de la requête
-- ═══════════════════════════════════════════════════════════════════════════
-- `request.headers` n'existe pas hors PostgREST (psql, pg_cron, service_role en
-- direct) : le `true` de `current_setting` rend alors NULL plutôt que de lever.
-- Un appelant sans en-tête n'est pas bloqué — voir le trigger, qui ne fait rien
-- quand l'identifiant manque.
--
-- Longueur minimale alignée sur `check_and_register_device_signup` : un UUID
-- v4 fait 36 caractères, et une valeur plus courte est soit une troncature, soit
-- une tentative de collision sur un identifiant court.
create or replace function public.request_device_id()
returns text
language plpgsql
stable
as $$
declare
  v text;
begin
  begin
    v := current_setting('request.headers', true)::json ->> 'x-device-id';
  exception when others then
    -- En-tête absent ou JSON illisible : on se comporte comme s'il n'y en avait
    -- pas. Ce chemin ne doit jamais faire échouer l'insertion d'une course.
    return null;
  end;
  if v is null or length(v) < 16 then
    return null;
  end if;
  return v;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. enforce_scan_quota — recopie de 20260830_welcome_credits.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Seul le bloc « plafond d'appareil » est nouveau. Tout le reste — fenêtre de
-- journée, tier effectif, FOR UPDATE, ordre de consommation des pools — est
-- inchangé et documenté dans la migration d'origine.
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
  -- changeant de compte.
  --
  -- L'absence de device_id ne bloque RIEN : un client trop ancien pour envoyer
  -- l'en-tête doit continuer à scanner. Le plafond du compte, lui, s'applique
  -- toujours — on ne troque pas une protection contre l'autre.
  v_device := public.request_device_id();
  v_day := day_start::date;

  if v_device is not null and v_tier = 'free' and daily_limit is not null then
    select coalesce(sum(scans), 0),
           coalesce(sum(scans) filter (where user_id = new.user_id), 0)
      into device_used, own_used
      from public.device_scan_ledger
     where device_id = v_device
       and day = v_day;

    -- `device_used > own_used` : au moins un AUTRE compte a scanné depuis ce
    -- téléphone aujourd'hui. Sans ce test, un chauffeur seul au bout de ses
    -- trois scans recevrait le message « plusieurs comptes » alors qu'il n'y en
    -- a qu'un — son propre plafond suffit à le refuser, avec le bon motif.
    --
    -- Les crédits achetés et le pool de bienvenue passent OUTRE ce plafond : ils
    -- appartiennent au compte, ils ont été payés ou offerts une seule fois par
    -- appareil (`welcome_grants`), et rien ne se farme en les dépensant.
    if device_used >= daily_limit
       and device_used > own_used
       and welcome <= 0
       and credits <= 0 then
      raise exception 'device_scan_quota_exceeded'
        using errcode = 'P0001';
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
-- 4. record_device_scan — l'écriture au registre
-- ═══════════════════════════════════════════════════════════════════════════
-- Séparée pour que les quatre sorties « scan accepté » de `enforce_scan_quota`
-- appellent la même chose : le registre doit compter TOUT scan accepté, y
-- compris ceux payés par un crédit ou par le pool de bienvenue. N'en compter
-- qu'une partie rendrait le plafond d'appareil faux dans un sens ou dans
-- l'autre.
--
-- `v_device is null` (client ancien, appel hors PostgREST) : rien à écrire, et
-- surtout pas d'échec — le scan a déjà été accepté à ce stade.
create or replace function public.record_device_scan(
  p_device text,
  p_day    date,
  p_user   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device is null then
    return;
  end if;
  insert into public.device_scan_ledger (device_id, day, user_id, scans)
       values (p_device, p_day, p_user, 1)
  on conflict (device_id, day, user_id) do update
          set scans = public.device_scan_ledger.scans + 1,
              updated_at = now();
end;
$$;

revoke execute on function public.record_device_scan(text, date, uuid) from public;
revoke execute on function public.request_device_id() from public;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. En-tête absent (psql) : `select public.request_device_id();` → NULL,
--    et une insertion de course passe comme avant.
--
-- 2. Farming : compte A (free) scanne 3 fois depuis l'appareil D, supprime son
--    compte, compte B se crée sur D et scanne.
--    → ERROR: device_scan_quota_exceeded
--    (avant cette migration : la course passait)
--
-- 3. Le chauffeur seul garde son message d'origine : compte A scanne 4 fois de
--    suite depuis D, sans autre compte.
--    → ERROR: daily_scan_quota_exceeded   (device_used = own_used)
--
-- 4. L'abonné n'est pas puni : compte A (free) épuise 3 scans sur D, compte B
--    (plus) se connecte sur D et scanne.
--    → accepté  (le plafond d'appareil ne vise que les comptes gratuits)
--
-- 5. Les crédits passent outre : compte B a 5 crédits achetés, D est épuisé.
--    → accepté, un crédit décompté
--
-- 6. Le registre survit à la suppression : après `delete_account` du compte A,
--    select scans, user_id from device_scan_ledger where device_id = '<D>';
--    → la ligne est là, `user_id` à NULL, `scans` inchangé
