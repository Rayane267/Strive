-- ═══════════════════════════════════════════════════════════════════════════
-- TZ utilisateur + reset day_reset_hour (0h ou 4h locale)
-- ═══════════════════════════════════════════════════════════════════════════
-- Ajoute profiles.timezone (IANA) et met à jour le trigger enforce_scan_quota
-- + RPC user_stats_today pour calculer la "journée user" en fonction de :
--   - profiles.timezone   (TZ du téléphone, ex: 'Europe/Paris')
--   - preferences.day_reset_hour  (0h par défaut, ou 4h pour chauffeurs de nuit)

-- 1. Colonne timezone
alter table public.profiles
  add column if not exists timezone text not null default 'Europe/Paris';

-- 2. Drop TOUTES les anciennes contraintes day_reset_hour AVANT update
--    (Supabase a pu en créer une avec un nom différent — preferences_day_reset_hour_check)
alter table public.preferences
  drop constraint if exists pref_day_reset_check,
  drop constraint if exists preferences_day_reset_hour_check;

-- Drop dynamique de toute autre contrainte CHECK sur day_reset_hour au cas où
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.preferences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%day_reset_hour%'
  loop
    execute format('alter table public.preferences drop constraint %I', c.conname);
  end loop;
end $$;

-- Migration des valeurs existantes : on normalise tout vers (0, 4)
-- Les anciens 3 deviennent 4. Toute autre valeur exotique → 0 (défaut).
update public.preferences set day_reset_hour = 4 where day_reset_hour = 3;
update public.preferences set day_reset_hour = 0
  where day_reset_hour is null or day_reset_hour not in (0, 4);

-- Ajout contrainte APRÈS migration des données
alter table public.preferences
  add constraint pref_day_reset_check check (day_reset_hour in (0, 4));

-- ═══════════════════════════════════════════════════════════════════════════
-- Helper : retourne le début de "la journée user" (timestamp UTC) en fonction
-- de sa TZ et de son day_reset_hour. Utilisé par le trigger quota et le RPC stats.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.user_day_start(uid uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  -- now_local = "maintenant" exprimé dans la TZ user (timestamp sans fuseau)
  -- day_start_local = jour calendaire local (00h) - décalé selon day_reset_hour :
  --   si offset_h = 4 et qu'il est 03h locale, on est encore "hier" → on retire 1 jour
  with user_pref as (
    select coalesce(p.timezone, 'Europe/Paris')   as tz,
           coalesce(pr.day_reset_hour, 0)          as offset_h
    from public.profiles p
    left join public.preferences pr on pr.id = p.id
    where p.id = uid
  )
  select
    (
      date_trunc(
        'day',
        (now() at time zone u.tz) - make_interval(hours => u.offset_h)
      )
      + make_interval(hours => u.offset_h)
    ) at time zone u.tz
  from user_pref u;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Trigger enforce_scan_quota — utilise user_day_start
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tier text;
  daily_limit int;
  count_today int;
  credits int;
  day_start timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  select coalesce(subscription_tier, 'free'),
         coalesce(extra_scan_credits, 0)
    into tier, credits
    from public.profiles where id = new.user_id;

  daily_limit := case
    when tier = 'free'                            then 3
    when tier = 'plus'                            then 50
    when tier in ('premium', 'pro')               then 999999
    else 3
  end;

  day_start := public.user_day_start(new.user_id);

  select count(*) into count_today
    from public.rides
    where user_id = new.user_id
      and created_at >= day_start;

  if count_today >= daily_limit and credits <= 0 then
    raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
  end if;

  if count_today >= daily_limit and credits > 0 then
    update public.profiles
      set extra_scan_credits = extra_scan_credits - 1
      where id = new.user_id;
  end if;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RPC user_stats_today — utilise aussi user_day_start
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.user_stats_today()
returns table (
  total_earnings   numeric,
  total_distance   numeric,
  total_duration   int,
  scans_count      int,
  accepted_count   int,
  declined_count   int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  day_start timestamptz;
begin
  day_start := public.user_day_start(auth.uid());

  return query
  select
    coalesce(sum(coalesce(fare_final, fare_estimated)), 0)::numeric,
    coalesce(sum(distance_km), 0)::numeric,
    coalesce(sum(duration_min), 0)::int,
    count(*)::int,
    count(*) filter (where status = 'ACCEPTED')::int,
    count(*) filter (where status = 'DECLINED')::int
  from public.rides
  where user_id = auth.uid()
    and created_at >= day_start;
end;
$$;

grant execute on function public.user_day_start(uuid)  to authenticated;
grant execute on function public.user_stats_today()    to authenticated;
revoke execute on function public.user_day_start(uuid)  from public;
revoke execute on function public.user_stats_today()    from public;
