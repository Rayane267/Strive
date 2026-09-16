-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ CADUC — SUPPRIMÉ PAR 20260822_scan_quota_on_profile.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Ce fichier reste ici parce qu'il a pu être appliqué : une migration jouée ne
-- se retire pas de l'historique. Mais ni la table `scan_ledger` ni la fonction
-- `quota_remaining_scans()` ne survivent à 20260822, qui les supprime après
-- avoir repris leur contenu dans `profiles.daily_scans_count`.
--
-- Ce qui l'a rendu caduc : 20260821 frappe l'id de la course AU SCAN, si bien
-- qu'un rejeu du journal natif n'insère plus rien. L'idempotence est acquise en
-- amont — c'était la seule raison d'avoir une table d'événements plutôt qu'un
-- compteur. Le raisonnement complet est en tête de 20260822.
--
-- Rien à lire ici pour comprendre le quota d'aujourd'hui.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- scan_ledger : un registre de scans que l'utilisateur ne peut pas effacer
-- ═══════════════════════════════════════════════════════════════════════════
-- LE PROBLÈME. Le quota se compte aujourd'hui sur `rides`, et l'app expose
-- « Supprimer mon historique » (`AccountInfoScreen`), qui exécute
-- `delete from rides where user_id = …` — ce que la policy `rides_delete_own`
-- autorise, et doit continuer d'autoriser : le RGPD l'exige.
--
-- Le compteur de quota et les données supprimables étaient donc la même chose.
-- Trois scans, un appui sur le bouton, trois scans de plus. À l'infini.
--
-- POURQUOI PAS UNE COLONNE COMPTEUR. Première tentative, écartée : le journal
-- natif `pendingScanResults` REJOUE les scans qu'il n'a pas pu insérer, parfois
-- des heures plus tard. Un compteur s'incrémente à chaque passage — un rejeu
-- comptait donc double. Une table dont la clé est le scan lui-même est
-- naturellement idempotente : réinsérer le même scan ne fait rien.
--
-- CE QUI FAIT AUTORITÉ. Cette table, et elle seule. Le compteur de l'App Group
-- reste un cache optimiste : il vit sur l'appareil du chauffeur, donc il ne peut
-- pas arbitrer, et il a le droit de se tromper — mais dans un seul sens. Laisser
-- passer un scan de trop coûte un scan ; bloquer un scan légitime immobilise un
-- chauffeur qui paie. Le cache est donc permissif, le serveur tranche.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.scan_ledger (
  id         bigserial primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- Horodatage du scan, clé de corrélation avec `rides.scan_ts`. NULL possible :
  -- payload d'un build antérieur encore en file, qui n'en portait pas.
  scan_ts    double precision,
  -- Heure du SCAN, pas de l'insertion — reprise de `rides.created_at`, que le
  -- client positionne déjà ainsi. Une course scannée app fermée n'arrive en base
  -- qu'à la réouverture ; dater l'événement de l'insertion la ferait basculer
  -- dans la mauvaise journée de travail.
  created_at timestamptz not null default now()
);

-- L'idempotence tient à cet index. `on conflict do nothing` s'y adosse : un scan
-- rejoué par le journal ne crée pas de second événement. Partiel, parce que
-- `scan_ts` peut être NULL et que NULL n'entre pas en conflit avec lui-même.
create unique index if not exists scan_ledger_user_scan_ts_uniq
  on public.scan_ledger (user_id, scan_ts)
  where scan_ts is not null;

create index if not exists scan_ledger_user_created_idx
  on public.scan_ledger (user_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS : lecture seule, et rien d'autre
-- ═══════════════════════════════════════════════════════════════════════════
-- Aucune policy `insert`, `update` ni `delete`. Le seul écrivain est le trigger
-- ci-dessous, `security definer`, qui n'est pas soumis aux policies. C'est tout
-- l'intérêt : le chauffeur voit son registre, il ne peut ni l'amender ni le
-- vider. Comparer avec `rides_delete_own`, qui existe et doit exister.
alter table public.scan_ledger enable row level security;

drop policy if exists "scan_ledger_select_own" on public.scan_ledger;
create policy "scan_ledger_select_own"
  on public.scan_ledger for select
  using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- enforce_scan_quota : compte le registre, plus les courses
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  daily_limit int;    -- NULL = illimité (premium)
  count_today int;
  credits     int;
  day_start   timestamptz;
  already     boolean;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  -- REJEU. Si ce scan a déjà son événement, il a déjà été payé : on laisse
  -- passer sans compter ni refuser. Sans ce test, le journal natif qui rejoue un
  -- scan des heures plus tard se ferait refuser une course déjà consommée — le
  -- chauffeur perdrait la course ET le scan.
  if new.scan_ts is not null then
    select exists (
      select 1 from public.scan_ledger
       where user_id = new.user_id and scan_ts = new.scan_ts
    ) into already;
    if already then
      return new;
    end if;
  end if;

  -- Tier EFFECTIF : un abo expiré retombe en 'free' même si l'event EXPIRATION
  -- du webhook a été manqué — sauf pendant la période de grâce (miroir exact de
  -- getEffectivePlanTier / GRACE_PERIOD_DAYS).
  --
  -- FOR UPDATE : sérialise les inserts concurrents du même user. Deux scans
  -- simultanés au seuil compteraient sinon tous les deux avant que l'un ne
  -- commite, et le quota serait dépassé d'une unité.
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

  -- Fenêtre de jour : TZ du chauffeur + day_reset_hour. Doit rester alignée avec
  -- `getDayStart()` côté app et `currentQuotaDay()` côté natif.
  day_start := public.user_day_start(new.user_id);

  -- Illimité : on enregistre quand même l'événement. Une rétrogradation vers
  -- free ne doit pas repartir d'un registre vide pour la journée en cours.
  if daily_limit is null then
    insert into public.scan_ledger (user_id, scan_ts, created_at)
    values (new.user_id, new.scan_ts, new.created_at)
    on conflict do nothing;
    return new;
  end if;

  select count(*) into count_today
    from public.scan_ledger
   where user_id = new.user_id
     and created_at >= day_start;

  if count_today >= daily_limit and credits <= 0 then
    raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
  end if;

  if count_today >= daily_limit and credits > 0 then
    -- `bypass_tier_check` : `prevent_tier_tampering` interdit d'écrire
    -- `extra_scan_credits`, y compris depuis ce trigger.
    perform set_config('app.bypass_tier_check', 'on', true);
    update public.profiles
      set extra_scan_credits = extra_scan_credits - 1
      where id = new.user_id;
  end if;

  insert into public.scan_ledger (user_id, scan_ts, created_at)
  values (new.user_id, new.scan_ts, new.created_at)
  on conflict do nothing;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- quota_remaining_scans : ce que le client doit AFFICHER
-- ═══════════════════════════════════════════════════════════════════════════
-- Pour que l'écran montre exactement ce que l'enforcement applique. Le client
-- recalculait jusqu'ici un substitut à partir des courses — d'où des « 2/3 »
-- affichés pendant que le serveur refusait, ce qui est indéfendable côté
-- chauffeur. Une seule source, exposée telle quelle.
--
-- Rend NULL pour un accès illimité.
create or replace function public.quota_remaining_scans()
returns table (used int, daily_limit int, remaining int, credits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier    text;
  v_limit   int;
  v_used    int;
  v_credits int;
begin
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
    into v_tier, v_credits
    from public.profiles
    where id = auth.uid();

  select pl.daily_scans into v_limit
    from public.plan_limits pl where pl.tier = v_tier;
  if not found then
    select pl.daily_scans into v_limit
      from public.plan_limits pl where pl.tier = 'free';
  end if;

  select count(*) into v_used
    from public.scan_ledger
   where user_id = auth.uid()
     and created_at >= public.user_day_start(auth.uid());

  return query select
    v_used,
    v_limit,
    case when v_limit is null then null
         else greatest(0, v_limit - v_used) + v_credits end,
    v_credits;
end;
$$;

grant execute on function public.quota_remaining_scans() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- REPRISE DE L'EXISTANT
-- ═══════════════════════════════════════════════════════════════════════════
-- Un événement par course déjà en base, pour que personne ne reparte d'un
-- registre vide au déploiement — ce qui offrirait une journée de scans gratuits
-- à tout le monde. `on conflict do nothing` rend la reprise rejouable.
insert into public.scan_ledger (user_id, scan_ts, created_at)
select r.user_id, r.scan_ts, r.created_at
  from public.rides r
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA FAILLE. Free, 3 scans, puis `delete from rides where user_id = '<uid>'`
--    → un 4e scan doit TOUJOURS être refusé. C'est la raison d'être du fichier.
--
-- 2. REJEU. Réinsérer une course avec un `scan_ts` déjà présent → doit PASSER
--    (c'est le journal natif qui rejoue) et ne pas créer de second événement :
--      select count(*) from scan_ledger where scan_ts = <le meme>;  -- => 1
--
-- 3. Le client ne peut pas amender le registre. En JWT `authenticated` :
--      insert into scan_ledger … ;   -- refusé
--      delete from scan_ledger … ;   -- refusé
--      select from scan_ledger … ;   -- OK, ses lignes seulement
--
-- 4. `select * from public.quota_remaining_scans();` doit rendre les mêmes chiffres
--    que ceux qui décident du refus. Free neuf → used 0, daily_limit 3,
--    remaining 3.
--
-- 5. Fenêtre de jour. day_reset_hour = 4, scan à 02h00 : compté sur la journée
--    de la veille, comme `user_stats_today` et `getDayStart()`.
--
-- 6. Concurrence. Deux inserts simultanés au seuil → un seul passe.
-- ═══════════════════════════════════════════════════════════════════════════
