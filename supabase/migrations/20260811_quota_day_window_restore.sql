-- ═══════════════════════════════════════════════════════════════════════════
-- enforce_scan_quota : rétablit la fenêtre de jour user et le verrou anti-race
-- ═══════════════════════════════════════════════════════════════════════════
-- `20260611_fix_quota_timezone.sql` avait remplacé le comptage
-- `date_trunc('day', now() at time zone 'Europe/Paris')` par
-- `public.user_day_start(user_id)` (TZ du user + day_reset_hour) et ajouté un
-- `SELECT … FOR UPDATE` pour sérialiser les inserts concurrents.
--
-- Les deux ont été perdus par recopie du corps de la fonction dans
-- `20260702_subscription_audit_fixes.sql`, puis reportés tels quels dans
-- `20260727_billing_grace_period.sql`. Conséquences en production :
--
--   • Un chauffeur avec day_reset_hour = 4, ou hors Europe/Paris, a un quota
--     serveur qui compte sur une autre journée que `user_stats_today`, que
--     `getDayStart(resetHour)` côté app et que `currentQuotaDay()` côté natif.
--     Un free à 3 scans qui scanne à 02h00 est compté sur le mauvais jour :
--     bloqué à tort, ou servi deux fois trop.
--   • `date_trunc('day', <timestamp>)` rend un `timestamp` sans fuseau, comparé
--     ensuite à un `timestamptz` : PostgreSQL le réinterprète dans la TZ de la
--     session (UTC), ce qui décale encore la borne du décalage de Paris.
--   • Sans `FOR UPDATE`, deux scans simultanés au seuil comptent tous les deux
--     avant que l'un ne commite → le quota est dépassé d'une unité.
--
-- La logique de tier effectif (période de grâce) de 20260727 est conservée
-- telle quelle : seuls le verrou et la borne de jour changent.
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
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  -- Tier EFFECTIF : un abo dont l'expiration est passée retombe en 'free', même
  -- si l'event EXPIRATION du webhook a été manqué — sauf pendant la période de
  -- grâce (miroir exact de getEffectivePlanTier / GRACE_PERIOD_DAYS).
  --
  -- FOR UPDATE : sérialise les inserts concurrents du même user → le count plus
  -- bas est exact même sous concurrence (le 2e insert attend le commit du 1er).
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

  if daily_limit is null then
    return new;
  end if;

  -- Fenêtre de jour ALIGNÉE avec user_stats_today, getDayStart() côté app et
  -- currentQuotaDay() côté natif : TZ du user + day_reset_hour.
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
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. En tant qu'user avec timezone <> 'Europe/Paris' et day_reset_hour = 4 :
--      select public.user_day_start(auth.uid());
--    → doit rendre 04h00 locale du jour courant (ou de la veille s'il est < 04h).
--
-- 2. Free à 3 scans, day_reset_hour = 4, à 02h00 locale : les scans de la
--    soirée précédente doivent encore compter (même journée de travail).
--
-- 3. Grâce : abonné 'in_grace_period' expiré depuis 3 jours → garde son tier ;
--    depuis 20 jours → retombe en 'free'.
--
-- 4. Concurrence : deux inserts simultanés d'un free au seuil → un seul passe.
