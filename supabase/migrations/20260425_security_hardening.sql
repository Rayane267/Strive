-- ═══════════════════════════════════════════════════════════════════════════
-- Security hardening — défense en profondeur Strive
-- ═══════════════════════════════════════════════════════════════════════════
-- À exécuter APRÈS 20260425_rls_policies.sql.
-- Couvre :
--   1. CHECK constraints sur les colonnes critiques
--   2. Trigger anti-tampering subscription_tier / quotas
--   3. Quota daily_scans appliqué côté DB (BEFORE INSERT rides)
--   4. Index pour perf + protection DOS
--   5. Storage policies (bucket avatars)
--   6. RPC user_stats_today (évite SELECT * côté client)
--   7. Audit log table (traçabilité actions sensibles)
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CHECK constraints — empêche les valeurs absurdes/malicieuses
-- ═══════════════════════════════════════════════════════════════════════════
-- IMPORTANT : on drop d'abord TOUTES les CHECK existantes (peu importe leur
-- nom) puis on nettoie les données qui violeraient les nouvelles contraintes,
-- enfin on ajoute les contraintes propres. Sinon l'ALTER plante sur les rows
-- existants dirty.

-- Drop dynamique de toutes les CHECK sur rides
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.rides'::regclass and contype = 'c'
  loop
    execute format('alter table public.rides drop constraint %I', c.conname);
  end loop;
end $$;

-- Nettoyage des données existantes hors-bornes (clamp aux limites)
update public.rides set fare_estimated = 0    where fare_estimated < 0;
update public.rides set fare_estimated = 1000 where fare_estimated > 1000;
update public.rides set fare_final = null     where fare_final is not null and (fare_final < 0 or fare_final > 1000);
update public.rides set distance_km = 0.1     where distance_km <= 0;
update public.rides set distance_km = 1000    where distance_km > 1000;
update public.rides set duration_min = 0      where duration_min < 0;
update public.rides set duration_min = 1200   where duration_min > 1200;
update public.rides set platform = 'UBER'     where platform not in ('UBER', 'BOLT', 'HEETCH') or platform is null;
update public.rides set status = 'PENDING'    where status not in ('PENDING', 'ACCEPTED', 'DECLINED') or status is null;
update public.rides set hourly_rate = 0       where hourly_rate < 0;
update public.rides set hourly_rate = 1000    where hourly_rate > 1000;
update public.rides set km_rate = 0           where km_rate < 0;
update public.rides set km_rate = 100         where km_rate > 100;

alter table public.rides
  add constraint rides_fare_estimated_check check (fare_estimated >= 0 and fare_estimated <= 1000),
  add constraint rides_fare_final_check     check (fare_final is null or (fare_final >= 0 and fare_final <= 1000)),
  add constraint rides_distance_km_check    check (distance_km > 0 and distance_km <= 1000),
  add constraint rides_duration_min_check   check (duration_min >= 0 and duration_min <= 1200),
  add constraint rides_platform_check       check (platform in ('UBER', 'BOLT', 'HEETCH')),
  add constraint rides_status_check         check (status in ('PENDING', 'ACCEPTED', 'DECLINED')),
  add constraint rides_hourly_rate_check    check (hourly_rate >= 0 and hourly_rate <= 1000),
  add constraint rides_km_rate_check        check (km_rate >= 0 and km_rate <= 100);

-- Drop dynamique de toutes les CHECK sur preferences
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.preferences'::regclass and contype = 'c'
  loop
    execute format('alter table public.preferences drop constraint %I', c.conname);
  end loop;
end $$;

-- Nettoyage preferences
update public.preferences set min_hourly_rate = 0   where min_hourly_rate < 0;
update public.preferences set min_hourly_rate = 200 where min_hourly_rate > 200;
update public.preferences set min_km_rate = 0       where min_km_rate < 0;
update public.preferences set min_km_rate = 50      where min_km_rate > 50;
update public.preferences set day_reset_hour = 4    where day_reset_hour = 3;
update public.preferences set day_reset_hour = 0    where day_reset_hour is null or day_reset_hour not in (0, 4);

alter table public.preferences
  add constraint pref_min_hourly_check  check (min_hourly_rate >= 0 and min_hourly_rate <= 200),
  add constraint pref_min_km_check      check (min_km_rate >= 0 and min_km_rate <= 50),
  add constraint pref_day_reset_check   check (day_reset_hour in (0, 4));

-- Drop dynamique de toutes les CHECK sur profiles
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

-- Nettoyage profiles
update public.profiles set subscription_tier = 'free'
  where subscription_tier is not null
    and subscription_tier not in ('free', 'plus', 'premium', 'pro');
update public.profiles set daily_scans_count = 0   where daily_scans_count < 0 or daily_scans_count is null;
update public.profiles set extra_scan_credits = 0  where extra_scan_credits < 0 or extra_scan_credits is null;

alter table public.profiles
  add constraint profile_subscription_tier_check check (
    subscription_tier is null or subscription_tier in ('free', 'plus', 'premium', 'pro')
  ),
  add constraint profile_daily_scans_check       check (daily_scans_count >= 0),
  add constraint profile_extra_credits_check     check (extra_scan_credits >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Trigger anti-tampering : subscription_tier et quotas read-only client
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans ça, n'importe quel user peut faire :
--    update profiles set subscription_tier='premium' where id=auth.uid()
-- depuis l'app et bénéficier des features premium gratuitement.
-- Ces colonnes ne doivent être modifiées que par le webhook RevenueCat
-- (qui appelle l'API Supabase avec le service_role).

create or replace function public.prevent_tier_tampering()
returns trigger
language plpgsql
as $$
begin
  -- service_role bypasse cette protection (webhook RevenueCat)
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

drop trigger if exists protect_tier_fields on public.profiles;
create trigger protect_tier_fields
  before update on public.profiles
  for each row execute function public.prevent_tier_tampering();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Quota daily_scans appliqué côté DB
-- ═══════════════════════════════════════════════════════════════════════════
-- Si l'utilisateur contourne le client (script Postman, jailbreak), il peut
-- spammer INSERT rides → coût Gemini explose côté serveur. On gate au niveau DB.

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
begin
  -- service_role bypasse (par ex. import batch admin)
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  select coalesce(subscription_tier, 'free'), coalesce(extra_scan_credits, 0)
    into tier, credits
    from public.profiles where id = new.user_id;

  -- Limites par tier (à garder en sync avec subscriptionService.ts)
  -- Free : 3 scans/jour, reset auto à 00h00 (UTC, ajuste si besoin par TZ user)
  daily_limit := case
    when tier = 'free'                            then 3
    when tier = 'plus'                            then 50
    when tier in ('premium', 'pro')               then 999999
    else 3
  end;

  select count(*) into count_today
    from public.rides
    where user_id = new.user_id
      and created_at >= date_trunc('day', now() at time zone 'Europe/Paris');

  -- Au-dessus du quota tier ET sans crédit extra → reject
  if count_today >= daily_limit and credits <= 0 then
    raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
  end if;

  -- Si quota tier dépassé, décrémente les crédits extra (bypass du trigger
  -- anti-tampering car on est en SECURITY DEFINER → service_role logique)
  if count_today >= daily_limit and credits > 0 then
    update public.profiles
      set extra_scan_credits = extra_scan_credits - 1
      where id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists check_scan_quota on public.rides;
create trigger check_scan_quota
  before insert on public.rides
  for each row execute function public.enforce_scan_quota();


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Index pour perf + protection DOS
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans index sur user_id, un SELECT massif fait un full table scan → DOS facile.

create index if not exists idx_rides_user_created
  on public.rides (user_id, created_at desc);

create index if not exists idx_rides_user_status
  on public.rides (user_id, status);

create index if not exists idx_online_sessions_user_start
  on public.online_sessions (user_id, start_at desc);

create index if not exists idx_cars_user
  on public.cars (user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Storage policies — bucket "avatars"
-- ═══════════════════════════════════════════════════════════════════════════
-- Convention : chaque user upload dans son dossier `<auth.uid()>/<filename>`.
-- Le bucket "avatars" doit être créé manuellement dans le Dashboard Storage.

-- Lecture publique (URLs d'avatar exposées dans profiles.avatar_url)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Upload : authentifié, dans son dossier uniquement
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update : authentifié, son fichier uniquement
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete : authentifié, son fichier uniquement
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RPC user_stats_today — évite SELECT * massif côté client
-- ═══════════════════════════════════════════════════════════════════════════
-- Le client appelle juste cette fonction → reçoit les agrégats déjà calculés.
-- Réduit la bande passante + protège de DOS via filtres complexes.

create or replace function public.user_stats_today()
returns table (
  total_earnings   numeric,
  total_distance   numeric,
  total_duration   int,
  scans_count      int,
  accepted_count   int,
  declined_count   int
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(coalesce(fare_final, fare_estimated)), 0)::numeric as total_earnings,
    coalesce(sum(distance_km), 0)::numeric                          as total_distance,
    coalesce(sum(duration_min), 0)::int                             as total_duration,
    count(*)::int                                                   as scans_count,
    count(*) filter (where status = 'ACCEPTED')::int                as accepted_count,
    count(*) filter (where status = 'DECLINED')::int                as declined_count
  from public.rides
  where user_id = auth.uid()
    and created_at >= date_trunc('day', now() at time zone 'Europe/Paris');
$$;

grant execute on function public.user_stats_today() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Audit log — traçabilité actions sensibles (RGPD, litiges, debug fraud)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,
  details     jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_user_created
  on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;

-- Lecture : un user peut voir son propre log (transparence RGPD)
drop policy if exists "audit_log_select_own" on public.audit_log;
create policy "audit_log_select_own"
  on public.audit_log for select
  to authenticated
  using (auth.uid() = user_id);

-- Écriture : service_role uniquement (via RPC ou edge function)
-- → aucune policy INSERT/UPDATE/DELETE pour authenticated → bloqué.

-- Helper : log d'événement sécurisé (à appeler depuis edge functions)
create or replace function public.log_event(
  p_action text,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, details)
  values (auth.uid(), p_action, p_details);
end;
$$;

grant execute on function public.log_event(text, jsonb) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Mise à jour delete_account RPC pour logguer la suppression
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Audit avant suppression (sinon on perd la trace avec ON DELETE SET NULL)
  insert into public.audit_log (user_id, action, details)
  values (uid, 'account_deleted', jsonb_build_object('deleted_at', now()));

  -- Cascade manuelle
  delete from public.rides           where user_id = uid;
  delete from public.online_sessions where user_id = uid;
  delete from public.cars            where user_id = uid;
  delete from public.preferences     where id = uid;
  delete from public.profiles        where id = uid;

  -- Supprime le compte auth
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_account() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. REVOKE des privilèges par défaut sur les fonctions publiques
-- ═══════════════════════════════════════════════════════════════════════════
-- PostgreSQL grant EXECUTE à PUBLIC par défaut sur toutes les fonctions.
-- On ne veut que les rôles authentifiés.

revoke execute on function public.delete_account()    from public;
revoke execute on function public.user_stats_today()  from public;
revoke execute on function public.log_event(text, jsonb) from public;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION (à lancer dans SQL Editor en tant que user authentifié)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tampering tier doit échouer :
--    update profiles set subscription_tier='premium' where id=auth.uid();
--    → ERROR: subscription_tier is read-only from client
--
-- 2. CHECK constraint doit échouer :
--    insert into rides (user_id, platform, fare_estimated, distance_km, duration_min)
--      values (auth.uid(), 'INVALID', 10, 5, 10);
--    → ERROR: violates check constraint rides_platform_check
--
-- 3. Quota tier free doit kicker au 4e scan du jour :
--    insert into rides (...) ; -- ×3 OK
--    insert into rides (...) ; -- 4e → ERROR: daily_scan_quota_exceeded
--
-- 4. Stats RPC :
--    select * from user_stats_today();
--    → renvoie les agrégats du jour
