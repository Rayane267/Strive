-- ═══════════════════════════════════════════════════════════════════════════
-- admin_feed : chaque « offre illisible » est rangée d'après sa capture
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `offer_unreadable` et `no_addresses` mêlaient deux choses : une vraie offre
-- que l'app n'a pas su lire (à corriger), et un écran qui n'en était pas une —
-- navigation, journal d'appels, accueil d'une app VTC sous une notification —
-- ou une offre déjà expirée (rien à corriger). La capture OCR jointe le dit.
--
-- `scan_capture_class` lit les blocs sous la bande que le parser ignore (25 %)
-- et compte quatre marques d'offre : bouton (Accepter, Proposer…), « Course de
-- X km », approche « X min (Y km) », adresse. Deux marques ou plus : 'offer'.
-- « plus disponible » : 'expired'. Sinon 'not_offer'. Sur les 55 captures du
-- 17/10/2026 : 50 offres, 1 expirée, 4 écrans sans offre, aucune erreur.
--
-- `scan_failure_capture` retrouve la capture d'un échec : même chauffeur,
-- insérée dans les 5 secondes (les deux lignes partent du même gestionnaire
-- JS), la plus proche, et du même motif quand la capture le porte (≥ 1.0.6).
--
-- `failures_recent` porte la classe (`capture`), `failures_by_capture` compte
-- les deux motifs par classe. Le reste est recopié de
-- 20261017_admin_feed_refusals.

create or replace function public.scan_capture_class(p_blocks jsonb, p_screen_height int)
returns text
language sql
immutable
as $$
  with t as (
    select b->>'text' as txt
    from jsonb_array_elements(
      case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end
    ) b
    -- Sous la bande que le parser ignore : notifications et Live Activity
    -- (dont celle de Strive) n'y comptent pas.
    where coalesce(p_screen_height, 0) <= 0
       or coalesce((b->>'y')::numeric, 0) + coalesce((b->>'h')::numeric, 0) / 2
          >= 0.25 * p_screen_height
  ),
  m as (
    select
      count(*) as n,
      coalesce(bool_or(txt ~* 'plus disponible|no longer available'), false) as expired,
        coalesce(bool_or(txt ~* '\m(accepter|accept|proposer|interested|aceptar|aceitar|akzeptieren|accetta|accepteren)\M|suis int.ress'), false)::int
      + coalesce(bool_or(txt ~* '\m(course de|trip|viaje|viagem|fahrt|corsa|rit|cursa)\M.{0,12}\d|\d[\d.,]*\s*(km|mi)\s+(trip|course)\M'), false)::int
      + coalesce(bool_or(txt ~* '\d+\s*min[a-z]*\s*\(\s*\d+[.,]?\d*\s*(km|mi)\s*\)'), false)::int
      + coalesce(bool_or(txt ~* '\m\d{5}\M|\m(rue|av|avenue|bd|boulevard|place|pl|quai|allée|chemin|route|street|st|road|rd)\M'), false)::int as marks
    from t
  )
  select case
    when n = 0      then null
    when expired    then 'expired'
    when marks >= 2 then 'offer'
    else 'not_offer'
  end
  from m
$$;

create or replace function public.scan_failure_capture(
  p_user_id    uuid,
  p_reason     text,
  p_created_at timestamptz
)
returns text
language sql
stable
set search_path = public
as $$
  select public.scan_capture_class(d.blocks, d.screen_height)
  from public.scan_debug d
  where p_reason in ('offer_unreadable', 'no_addresses')
    and d.user_id = p_user_id
    and d.created_at between p_created_at - interval '5 seconds'
                         and p_created_at + interval '5 seconds'
    and (d.failure_reason is null or d.failure_reason = p_reason)
  order by abs(extract(epoch from d.created_at - p_created_at))
  limit 1
$$;

-- Outils internes d'admin_feed : pas d'appel direct.
revoke execute on function public.scan_capture_class(jsonb, int) from public, anon, authenticated;
revoke execute on function public.scan_failure_capture(uuid, text, timestamptz) from public, anon, authenticated;

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
  -- Scans bloqués par une règle avant toute lecture : pas des échecs.
  v_refusals text[] := array['scanner_off', 'session_off', 'quota_reached', 'throttled'];
  -- Hors des décomptes d'échecs : ces refus, et la carte non affichée (la
  -- course a été mesurée).
  v_not_failures text[] := array_append(v_refusals, 'la_start_failed');
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
          coalesce(p.email, u.email) as email,
          public.scan_failure_capture(f.user_id, f.reason, f.created_at) as capture
        from public.scan_failures f
        left join public.profiles p on p.id = f.user_id
        left join auth.users     u on u.id = f.user_id
        where f.reason <> all(v_refusals)
        order by coalesce(f.occurred_at, f.created_at) desc
        limit v_limit
      ) x
    ),

    -- Les refus, à part : utiles pour voir qui bute sur le quota ou oublie de
    -- démarrer sa session, sans masquer les erreurs à corriger.
    'refusals_recent', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
      from (
        select
          coalesce(f.occurred_at, f.created_at) as at,
          f.reason, f.os, f.surface, f.platform, f.detail, f.app_version,
          coalesce(p.email, u.email) as email
        from public.scan_failures f
        left join public.profiles p on p.id = f.user_id
        left join auth.users     u on u.id = f.user_id
        where f.reason = any(v_refusals)
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

    -- Les deux motifs qui joignent une capture, par classe : vraie offre mal
    -- lue, offre expirée, pas une offre, ou NULL (pas de capture retrouvée).
    'failures_by_capture', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.reason, x.total desc), '[]'::jsonb)
      from (
        select s.reason, s.capture, count(*)::int as total
        from (
          select f.reason,
                 public.scan_failure_capture(f.user_id, f.reason, f.created_at) as capture
          from public.scan_failures f
          where f.created_at >= v_since
            and f.reason in ('offer_unreadable', 'no_addresses')
        ) s
        group by 1, 2
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
          and f.reason <> all(v_not_failures)
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
              and f.reason <> all(v_not_failures))::int as failures,
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
    -- La compter ici la comptait deux fois. Sauf aussi les refus : aucune
    -- tentative de lecture n'a eu lieu.
    'failure_rate', (
      select case
        when (select count(*) from public.scan_events where created_at >= v_since)
           + (select count(*) from public.scan_failures
               where created_at >= v_since and reason <> all(v_not_failures)) = 0
        then null
        else round(
          100.0 * (select count(*) from public.scan_failures
               where created_at >= v_since and reason <> all(v_not_failures))
          / ((select count(*) from public.scan_events   where created_at >= v_since)
           + (select count(*) from public.scan_failures
               where created_at >= v_since and reason <> all(v_not_failures)))::numeric, 1)
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
