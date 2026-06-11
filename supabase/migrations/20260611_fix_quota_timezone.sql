-- ═══════════════════════════════════════════════════════════════════════════
-- Fix : enforce_scan_quota — restaure user_day_start + verrou anti-race
-- ═══════════════════════════════════════════════════════════════════════════
-- Régression introduite par 20260517_plan_limits.sql : en refactorant le
-- trigger pour lire plan_limits, la fenêtre de jour est repassée à
-- date_trunc('day', now() at time zone 'Europe/Paris') hardcodé, alors que
-- 20260425_user_timezone.sql avait introduit user_day_start(uid) (TZ user +
-- day_reset_hour 0h/4h) — toujours utilisé par user_stats_today.
-- → quota et stats comptaient sur deux fenêtres différentes pour tout user
--   hors Europe/Paris ou avec day_reset_hour = 4.
--
-- Cette migration réunifie : lookup plan_limits (gardé) + user_day_start
-- (restauré). Bonus : SELECT ... FOR UPDATE sur profiles pour sérialiser les
-- inserts concurrents d'un même user (avant, deux scans simultanés au seuil
-- passaient tous les deux — count puis insert sans verrou).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  daily_limit int;    -- NULL = unlimited
  count_today int;
  credits     int;
  day_start   timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  -- FOR UPDATE : sérialise les inserts concurrents du même user → le count
  -- ci-dessous est exact même sous concurrence (le 2e insert attend le commit
  -- du 1er avant de compter).
  select coalesce(subscription_tier, 'free'),
         coalesce(extra_scan_credits, 0)
    into v_tier, credits
    from public.profiles
    where id = new.user_id
    for update;

  -- Lookup limite depuis plan_limits — fallback 'free' si tier inconnu
  select pl.daily_scans into daily_limit
    from public.plan_limits pl
    where pl.tier = v_tier;
  if not found then
    select pl.daily_scans into daily_limit
      from public.plan_limits pl
      where pl.tier = 'free';
  end if;

  -- daily_limit = NULL → unlimited (premium), aucun check
  if daily_limit is null then
    return new;
  end if;

  -- Fenêtre de jour ALIGNÉE avec user_stats_today : TZ user + day_reset_hour
  day_start := public.user_day_start(new.user_id);

  select count(*) into count_today
    from public.rides
    where user_id = new.user_id
      and created_at >= day_start;

  if count_today >= daily_limit and credits <= 0 then
    raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
  end if;

  if count_today >= daily_limit and credits > 0 then
    perform set_config('app.bypass_tier_check', 'on', true);
    update public.profiles
      set extra_scan_credits = extra_scan_credits - 1
      where id = new.user_id;
  end if;

  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Cohérence quota/stats : en tant que user avec timezone != Europe/Paris
--    (ex: 'America/Martinique') et day_reset_hour = 4 :
--    select public.user_day_start(auth.uid());
--    → doit correspondre à 04h00 locale du jour courant (ou veille si < 04h)
--
-- 2. Quota free à 3 : scanner 4× → le 4e échoue 'daily_scan_quota_exceeded'
--    en comptant depuis user_day_start, PAS depuis minuit Paris.
--
-- 3. Crédits : user free au quota avec extra_scan_credits = 2 →
--    scan OK et crédits passent à 1 (pas d'erreur tier-tampering).
