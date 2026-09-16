-- ═══════════════════════════════════════════════════════════════════════════
-- admin_analytics — agrégats produit pour la console d'administration web
-- ═══════════════════════════════════════════════════════════════════════════
-- Pourquoi un RPC et pas des `select` depuis le navigateur :
--   1. scan_events est en RLS "chacun ne voit que ses lignes" (cf.
--      20260607_scan_events.sql) — un admin ne peut donc PAS agréger le parc
--      depuis le client, par construction. Ce n'est pas un contournement de la
--      RLS : la fonction est SECURITY DEFINER et vérifie is_admin() d'abord.
--   2. Aucune donnée nominative ne quitte la base : seuls des compteurs et des
--      moyennes sortent d'ici. Le navigateur ne voit jamais une ligne rides,
--      profiles ou scan_events.
--   3. Un aller-retour au lieu d'une dizaine.
--
-- Fenêtre glissante paramétrable (p_days), bornée à 365 jours.
-- ═══════════════════════════════════════════════════════════════════════════

-- Les agrégats balayent par date sans filtre user_id : index dédiés.
create index if not exists idx_rides_created
  on public.rides (created_at desc);
create index if not exists idx_online_sessions_start
  on public.online_sessions (start_at desc);
create index if not exists idx_support_tickets_created
  on public.support_tickets (created_at desc);

create or replace function public.admin_analytics(p_days int default 30)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_days  int         := greatest(1, least(365, coalesce(p_days, 30)));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  -- Garde-fou : réservé aux comptes admin. 42501 = insufficient_privilege,
  -- que PostgREST renvoie en 403.
  if not public.is_admin() then
    raise exception 'admin_analytics: accès réservé aux administrateurs'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    -- ── Utilisateurs ────────────────────────────────────────────────────
    'users', (
      select jsonb_build_object(
        'total',      count(*),
        'new_7d',     count(*) filter (where created_at >= now() - interval '7 days'),
        'new_30d',    count(*) filter (where created_at >= now() - interval '30 days'),
        'new_window', count(*) filter (where created_at >= v_since)
      )
      from auth.users
      where deleted_at is null
    ),
    'active_users', (
      select jsonb_build_object(
        'window', (select count(distinct user_id) from public.rides where created_at >= v_since),
        'd7',     (select count(distinct user_id) from public.rides where created_at >= now() - interval '7 days')
      )
    ),

    -- ── Abonnements ─────────────────────────────────────────────────────
    'subscriptions', (
      select jsonb_build_object(
        'free',      count(*) filter (where coalesce(subscription_tier, 'free') = 'free'),
        'plus',      count(*) filter (where subscription_tier = 'plus'),
        'premium',   count(*) filter (where subscription_tier = 'premium'),
        'active',    count(*) filter (where subscription_status = 'active'),
        'grace',     count(*) filter (where subscription_status = 'in_grace_period'),
        'cancelled', count(*) filter (where subscription_status = 'cancelled')
      )
      from public.profiles
    ),

    -- ── Scans (télémétrie non nominative) ───────────────────────────────
    'scans', (
      select jsonb_build_object(
        'total',          count(*),
        'both_addresses', count(*) filter (where addresses_found = 2),
        'gemini_fallback',count(*) filter (where gemini_fallback),
        'verdict_good',   count(*) filter (where verdict = 2),
        'verdict_mid',    count(*) filter (where verdict = 1),
        'verdict_bad',    count(*) filter (where verdict = 0)
      )
      from public.scan_events
      where created_at >= v_since
    ),
    'scans_by_platform', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]'::jsonb)
      from (
        select
          coalesce(nullif(platform, ''), 'inconnu')          as platform,
          count(*)::int                                      as total,
          count(*) filter (where addresses_found = 2)::int    as both_addresses,
          count(*) filter (where gemini_fallback)::int        as fallback
        from public.scan_events
        where created_at >= v_since
        group by 1
      ) x
    ),
    -- Série journalière : generate_series remplit les jours vides, sinon l'axe
    -- temporel saute les trous et la courbe ment.
    'scans_daily', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb)
      from (
        select
          gs.d::date                                            as day,
          count(se.id)::int                                     as total,
          count(se.id) filter (where se.gemini_fallback)::int    as fallback
        from generate_series(
               date_trunc('day', v_since),
               date_trunc('day', now()),
               interval '1 day'
             ) gs(d)
        left join public.scan_events se
          on se.created_at >= gs.d
         and se.created_at <  gs.d + interval '1 day'
        group by 1
      ) d
    ),

    -- ── Courses ─────────────────────────────────────────────────────────
    'rides', (
      select jsonb_build_object(
        'total',           count(*),
        'accepted',        count(*) filter (where status = 'ACCEPTED'),
        'declined',        count(*) filter (where status = 'DECLINED'),
        'avg_hourly_rate', round(avg(hourly_rate)   filter (where hourly_rate   > 0)::numeric, 2),
        'avg_fare',        round(avg(fare_estimated) filter (where fare_estimated > 0)::numeric, 2)
      )
      from public.rides
      where created_at >= v_since
    ),

    -- ── Sessions de conduite ────────────────────────────────────────────
    'sessions', (
      select jsonb_build_object(
        'total',       count(*),
        'total_hours', round((coalesce(sum(duration_seconds), 0) / 3600.0)::numeric, 1),
        'avg_hours',   round((coalesce(avg(nullif(duration_seconds, 0)), 0) / 3600.0)::numeric, 2)
      )
      from public.online_sessions
      where start_at >= v_since
    ),

    -- ── Support ─────────────────────────────────────────────────────────
    'support', (
      select jsonb_build_object(
        'open',       count(*) filter (where status = 'open'),
        'answered',   count(*) filter (where status = 'answered'),
        'closed',     count(*) filter (where status = 'closed'),
        'new_window', count(*) filter (where created_at >= v_since)
      )
      from public.support_tickets
    ),
    -- Délai médian de première réponse staff (minutes) sur la fenêtre.
    'support_first_reply_minutes', (
      select round((
        percentile_cont(0.5) within group (
          order by extract(epoch from (r.first_staff - t.created_at)) / 60.0
        ))::numeric, 0)
      from public.support_tickets t
      join lateral (
        select min(m.created_at) as first_staff
        from public.support_messages m
        where m.ticket_id = t.id and m.sender = 'staff'
      ) r on true
      where r.first_staff is not null
        and t.created_at >= v_since
    )
  );
end;
$$;

revoke execute on function public.admin_analytics(int) from public;
grant  execute on function public.admin_analytics(int) to authenticated;

comment on function public.admin_analytics(int) is
  'Agrégats produit pour la console admin web. Vérifie is_admin() ; ne renvoie aucune donnée nominative.';
