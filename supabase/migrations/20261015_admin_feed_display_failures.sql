-- ═══════════════════════════════════════════════════════════════════════════
-- admin_feed : « carte non affichée » sort du décompte des échecs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `la_start_failed` n'est pas un scan raté. L'offre a été lue, mesurée et
-- enregistrée ; seule la Live Activity n'a pas pu l'afficher, et le verdict est
-- parti en notification. Le scan figure donc AUSSI dans `scan_events` : le taux
-- d'échec le comptait deux fois, et la courbe des échecs montait pour un
-- problème d'affichage.
--
-- Il reste dans `failures_recent` et `failures_by_reason` : la console l'y
-- affiche à part, comme un incident d'affichage. Il sort de
-- `failures_by_version`, `failures_daily` et `failure_rate`.
--
-- Le reste de la fonction est recopié à l'identique de 20260916_admin_feed.

create or replace function public.admin_feed(
  p_days  int default 30,
  p_limit int default 25
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_days  int         := greatest(1, least(365, coalesce(p_days, 30)));
  v_limit int         := greatest(1, least(100, coalesce(p_limit, 25)));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if not public.is_admin() then
    raise exception 'admin_feed: accès réservé aux administrateurs'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    -- ══ Abonnements ═══════════════════════════════════════════════════
    -- Le flux nominatif : qui, quel événement, quel produit, quand.
    'subs_recent', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select
          a.created_at,
          a.user_id,
          coalesce(p.email, u.email) as email,
          a.details->>'event_type'   as event_type,
          a.details->>'product_id'   as product_id,
          a.details->>'status'       as status,
          (a.details->>'expires_at')::timestamptz as expires_at,
          coalesce(p.subscription_tier, 'free')   as tier_now
        from public.audit_log a
        left join public.profiles p on p.id = a.user_id
        left join auth.users     u on u.id = a.user_id
        where a.action = 'revenuecat_event'
        order by a.created_at desc
        limit v_limit
      ) x
    ),

    -- Répartition par type sur la fenêtre : c'est là qu'on voit un pic
    -- d'annulations ou une vague de BILLING_ISSUE avant qu'elle ne se lise
    -- dans le nombre d'abonnés.
    'subs_by_type', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]'::jsonb)
      from (
        select
          coalesce(a.details->>'event_type', 'inconnu') as event_type,
          count(*)::int                                 as total
        from public.audit_log a
        where a.action = 'revenuecat_event' and a.created_at >= v_since
        group by 1
      ) x
    ),

    -- Abonnements en cours, comptés par produit : la console y applique les
    -- prix qu'elle affiche pour en tirer un revenu mensualisé.
    'subs_active_by_product', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.product_id), '[]'::jsonb)
      from (
        select
          coalesce(p.subscription_product_id, 'inconnu') as product_id,
          coalesce(p.subscription_tier, 'free')          as tier,
          count(*)::int                                  as total
        from public.profiles p
        where coalesce(p.subscription_tier, 'free') <> 'free'
          and coalesce(p.subscription_status, '') in ('active', 'in_grace_period')
        group by 1, 2
      ) x
    ),

    -- Échéances des trente prochains jours : qui va se renouveler, et qui va
    -- tomber si rien ne se passe.
    'subs_expiring', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.expires_at), '[]'::jsonb)
      from (
        select
          p.id as user_id,
          coalesce(p.email, u.email)            as email,
          coalesce(p.subscription_tier, 'free') as tier,
          p.subscription_status                 as status,
          p.subscription_expires_at             as expires_at
        from public.profiles p
        join auth.users u on u.id = p.id and u.deleted_at is null
        where p.subscription_expires_at between now() and now() + interval '30 days'
        order by p.subscription_expires_at
        limit v_limit
      ) x
    ),

    -- ══ Échecs de scan ════════════════════════════════════════════════
    'failures_recent', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
      from (
        select
          coalesce(f.occurred_at, f.created_at) as at,
          f.reason, f.os, f.surface, f.platform, f.detail, f.app_version,
          coalesce(p.email, u.email) as email
        from public.scan_failures f
        left join public.profiles p on p.id = f.user_id
        left join auth.users     u on u.id = f.user_id
        order by coalesce(f.occurred_at, f.created_at) desc
        limit v_limit
      ) x
    ),

    'failures_by_reason', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]'::jsonb)
      from (
        select f.reason, count(*)::int as total
        from public.scan_failures f
        where f.created_at >= v_since
        group by 1
      ) x
    ),

    -- Par version : c'est la colonne qui désigne une régression. Un motif qui
    -- explose sur une seule version n'est pas un problème de terrain, c'est
    -- une livraison.
    'failures_by_version', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]'::jsonb)
      from (
        select
          coalesce(nullif(f.app_version, ''), 'inconnue') as app_version,
          count(*)::int                                   as total,
          count(distinct f.user_id)::int                  as users
        from public.scan_failures f
        where f.created_at >= v_since
          and f.reason <> 'la_start_failed'
        group by 1
        limit 12
      ) x
    ),

    'failures_daily', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb)
      from (
        select
          gs.d::date as day,
          (select count(*) from public.scan_failures f
            where f.created_at >= gs.d and f.created_at < gs.d + interval '1 day'
              and f.reason <> 'la_start_failed')::int as failures,
          (select count(*) from public.scan_events e
            where e.created_at >= gs.d and e.created_at < gs.d + interval '1 day')::int as scans
        from generate_series(date_trunc('day', v_since),
                             date_trunc('day', now()), interval '1 day') gs(d)
      ) d
    ),

    -- Taux d'échec de la fenêtre : un scan raté n'apparaît pas dans
    -- `scan_events`, les deux tables se complètent au lieu de se recouper.
    -- Sauf `la_start_failed`, qui n'est pas un scan raté : la course a été
    -- mesurée (elle EST dans `scan_events`), seule la carte ne l'a pas montrée.
    -- La compter ici la comptait deux fois.
    'failure_rate', (
      select case
        when (select count(*) from public.scan_events where created_at >= v_since)
           + (select count(*) from public.scan_failures
               where created_at >= v_since and reason <> 'la_start_failed') = 0
        then null
        else round(
          100.0 * (select count(*) from public.scan_failures
               where created_at >= v_since and reason <> 'la_start_failed')
          / ((select count(*) from public.scan_events   where created_at >= v_since)
           + (select count(*) from public.scan_failures
               where created_at >= v_since and reason <> 'la_start_failed'))::numeric, 1)
      end
    ),

    -- ══ Comptes ═══════════════════════════════════════════════════════
    -- Tout l'audit qui n'est pas RevenueCat : suppressions, garde-fous.
    'audit_recent', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select
          a.created_at, a.action, a.details,
          coalesce(p.email, u.email) as email
        from public.audit_log a
        left join public.profiles p on p.id = a.user_id
        left join auth.users     u on u.id = a.user_id
        where a.action <> 'revenuecat_event'
        order by a.created_at desc
        limit v_limit
      ) x
    ),

    'signups_daily', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb)
      from (
        select
          gs.d::date as day,
          (select count(*) from auth.users u
            where u.deleted_at is null
              and u.created_at >= gs.d and u.created_at < gs.d + interval '1 day')::int as signups
        from generate_series(date_trunc('day', v_since),
                             date_trunc('day', now()), interval '1 day') gs(d)
      ) d
    ),

    -- Activation : un compte créé qui n'a jamais scanné n'est pas un
    -- utilisateur, c'est un téléchargement. La distinction change la lecture
    -- de « comptes totaux ».
    'activation', (
      select jsonb_build_object(
        'signups',   count(*),
        'scanned',   count(*) filter (where exists (
                        select 1 from public.scan_events e where e.user_id = u.id)),
        'rode',      count(*) filter (where exists (
                        select 1 from public.rides r where r.user_id = u.id)),
        'paid',      count(*) filter (where exists (
                        select 1 from public.profiles p
                        where p.id = u.id and coalesce(p.subscription_tier, 'free') <> 'free'))
      )
      from auth.users u
      where u.deleted_at is null and u.created_at >= v_since
    ),

    'waitlist', (
      select jsonb_build_object(
        'total',  count(*),
        'window', count(*) filter (where created_at >= v_since)
      )
      from public.waitlist
    )
  );
end;
$$;

revoke execute on function public.admin_feed(int, int) from public;
grant  execute on function public.admin_feed(int, int) to authenticated;
