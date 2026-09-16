-- ═══════════════════════════════════════════════════════════════════════════
-- Console admin — temps réel, liste des chauffeurs, fiche individuelle
-- ═══════════════════════════════════════════════════════════════════════════
-- Complète `20260916_admin_analytics.sql`, qui ne rend que des agrégats parc.
-- Ces trois fonctions-ci rendent du NOMINATIF (e-mail, nom, palier, activité) :
-- c'est le but d'une console de support, mais ça change le niveau de risque.
-- D'où trois décisions :
--
--   1. Rien n'est ouvert par une policy RLS. Ajouter « les admins lisent tout
--      `profiles` » aurait ouvert la table à TOUTE requête PostgREST du
--      navigateur, pour toujours. Ici la surface est exactement ce que ces
--      fonctions renvoient, et rien d'autre.
--   2. Chaque fonction re-vérifie `is_admin()`. `security definer` s'exécute
--      avec les droits du propriétaire : sans ce garde, n'importe quel compte
--      authentifié lirait le fichier clients.
--   3. Les adresses de course ne sortent jamais. Le support a besoin du palier,
--      du quota et du rythme d'activité ; il n'a pas besoin de savoir où un
--      chauffeur a conduit hier soir.
--
-- Les montants sont consolidés en euros au taux FIGÉ de chaque course
-- (`fx_rate_eur`, unités de devise pour 1 EUR). Sommer les `fare_*` bruts
-- mélangerait des livres et des euros dans le même total — c'est précisément
-- ce que 20260915_ride_currency.sql a corrigé côté app.
-- ═══════════════════════════════════════════════════════════════════════════

-- Les agrégats par chauffeur balayent par (user_id, date) : sans ces index,
-- chaque ligne de la liste déclenche un seq scan de `rides` et `scan_events`.
create index if not exists idx_rides_user_created
  on public.rides (user_id, created_at desc);
create index if not exists idx_scan_events_user_created
  on public.scan_events (user_id, created_at desc);
create index if not exists idx_online_sessions_user_start
  on public.online_sessions (user_id, start_at desc);
-- Index partiel : les sessions ouvertes sont une poignée de lignes dans une
-- table qui grossit indéfiniment. Le « qui est en ligne » doit les trouver
-- sans lire l'historique.
create index if not exists idx_online_sessions_open
  on public.online_sessions (start_at desc) where end_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. admin_live() — qui roule en ce moment
-- ═══════════════════════════════════════════════════════════════════════════
-- Appelée en boucle courte par la console (rafraîchissement ~30 s), donc
-- volontairement étroite : pas de fenêtre glissante, pas de série temporelle.
--
-- « En ligne » = une session `online_sessions` ouverte (end_at is null). Le
-- drapeau `profiles.is_online` ne suffit pas : il reste à `true` si l'app est
-- tuée avant d'avoir pu le remettre. On renvoie les deux et leur écart
-- (`incoherent`), parce que cet écart est lui-même un signal — c'est le nombre
-- de chauffeurs que l'app a lâchés sans refermer proprement.
create or replace function public.admin_live()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_live: accès réservé aux administrateurs'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),

    'counts', (
      select jsonb_build_object(
        'sessions_open', count(*),
        -- L'app coupe et rouvre la session à l'heure de reset du chauffeur :
        -- au-delà de 16 h, la session n'est pas longue, elle est orpheline.
        'stale',         count(*) filter (where s.start_at < now() - interval '16 hours'),
        'flag_online',   (select count(*) from public.profiles where is_online),
        'incoherent',    (
          select count(*) from public.profiles p
          where p.is_online
            and not exists (
              select 1 from public.online_sessions o
              where o.user_id = p.id and o.end_at is null
            )
        )
      )
      from public.online_sessions s
      where s.end_at is null
    ),

    'drivers', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.since), '[]'::jsonb)
      from (
        select
          p.id,
          coalesce(p.email, u.email)                               as email,
          nullif(trim(coalesce(p.first_name, '') || ' ' ||
                      coalesce(p.last_name, '')), '')              as name,
          coalesce(p.subscription_tier, 'free')                    as tier,
          p.country,
          p.is_online                                              as flag_online,
          s.start_at                                               as since,
          round(extract(epoch from (now() - s.start_at)) / 60.0)::int as minutes,
          s.start_at < now() - interval '16 hours'                 as stale,
          coalesce(p.daily_scans_count, 0)                         as scans_today,
          (select count(*) from public.rides r
            where r.user_id = p.id and r.created_at >= current_date)::int as rides_today,
          (select max(r.created_at) from public.rides r where r.user_id = p.id) as last_ride_at
        from public.online_sessions s
        join public.profiles  p on p.id = s.user_id
        join auth.users       u on u.id = p.id and u.deleted_at is null
        where s.end_at is null
      ) d
    )
  );
end;
$$;

revoke execute on function public.admin_live() from public;
grant  execute on function public.admin_live() to authenticated;

comment on function public.admin_live() is
  'Chauffeurs actuellement en ligne (session ouverte). Vérifie is_admin().';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. admin_drivers(...) — la liste, filtrable, triable, paginée
-- ═══════════════════════════════════════════════════════════════════════════
-- Les agrégats par chauffeur sont calculés APRÈS la pagination :
-- seules les lignes de la page courante coûtent un balayage, pas tout le parc.
--
-- Le tri passe par un `case` sur une liste blanche, jamais par du SQL
-- dynamique : `p_sort` vient du navigateur.
create or replace function public.admin_drivers(
  p_search text    default null,
  p_tier   text    default null,   -- 'free' | 'plus' | 'premium'
  p_online boolean default null,   -- true = uniquement ceux en ligne
  p_sort   text    default 'last_seen',
  p_limit  int     default 50,
  p_offset int     default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_limit  int  := greatest(1, least(200, coalesce(p_limit, 50)));
  v_offset int  := greatest(0, coalesce(p_offset, 0));
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_sort   text := coalesce(p_sort, 'last_seen');
  v_out    jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_drivers: acces reserve aux administrateurs'
      using errcode = '42501';
  end if;

  -- Tout en CTE, pas de table temporaire : PostgREST execute les fonctions
  -- `stable` dans une transaction READ ONLY, ou le moindre CREATE echoue.
  with base as (
    select
      p.id,
      coalesce(p.email, u.email) as email,
      nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as name,
      coalesce(p.subscription_tier, 'free') as tier,
      p.subscription_status  as status,
      u.created_at,
      u.last_sign_in_at,
      p.is_online,
      o.start_at as session_since,
      -- « Vu pour la derniere fois » : le plus recent des trois signaux reels
      -- d'usage. La connexion seule ne dit rien — une session peut rester
      -- valide des semaines sans que l'app serve.
      greatest(
        coalesce(u.last_sign_in_at, 'epoch'::timestamptz),
        coalesce((select max(r.created_at) from public.rides r where r.user_id = p.id), 'epoch'::timestamptz),
        coalesce((select max(e.created_at) from public.scan_events e where e.user_id = p.id), 'epoch'::timestamptz)
      ) as last_seen
    from public.profiles p
    join auth.users u on u.id = p.id and u.deleted_at is null
    left join lateral (
      select s.start_at from public.online_sessions s
      where s.user_id = p.id and s.end_at is null
      order by s.start_at desc limit 1
    ) o on true
    where (v_search is null
           or coalesce(p.email, u.email) ilike '%' || v_search || '%'
           or coalesce(p.first_name, '')  ilike '%' || v_search || '%'
           or coalesce(p.last_name, '')   ilike '%' || v_search || '%'
           or p.id::text = v_search)
      and (p_tier is null or coalesce(p.subscription_tier, 'free') = p_tier)
      and (p_online is null
           or (p_online and o.start_at is not null)
           or (not p_online and o.start_at is null))
  ),
  -- Le tri passe par un `case` sur liste blanche, jamais par du SQL
  -- dynamique : `p_sort` vient du navigateur.
  page as (
    select b.*, row_number() over () as rn
    from (
      select * from base
      order by
        case when v_sort = 'last_seen'  then last_seen  end desc nulls last,
        case when v_sort = 'created_at' then created_at end desc nulls last,
        -- Par palier : l'ordre qui a du sens est premium > plus > gratuit,
        -- pas l'ordre alphabetique, ou « plus » passe devant « premium ».
        case when v_sort = 'tier'
             then case tier when 'premium' then 3 when 'plus' then 2 else 1 end
        end desc nulls last,
        case when v_sort = 'email'      then email      end asc  nulls last,
        last_seen desc nulls last
      limit v_limit offset v_offset
    ) b
  ),
  -- Les agregats par chauffeur sont calcules APRES la pagination : seules les
  -- lignes affichees coutent un balayage, pas tout le parc.
  rows_out as (
    select
      b.rn, b.id, b.email, b.name, b.tier, b.status,
      b.created_at, b.last_sign_in_at, b.last_seen,
      b.is_online, b.session_since,
      p.country,
      p.subscription_expires_at         as expires_at,
      coalesce(p.daily_scans_count, 0)  as scans_today,
      p.daily_scans_day,
      coalesce(p.extra_scan_credits, 0) as credits,
      coalesce(p.welcome_credits, 0)    as welcome_credits,
      p.welcome_credits_expires_at      as welcome_expires_at,
      (select count(*) from public.scan_events e
        where e.user_id = b.id and e.created_at >= now() - interval '7 days')::int  as scans_7d,
      (select count(*) from public.scan_events e
        where e.user_id = b.id and e.created_at >= now() - interval '30 days')::int as scans_30d,
      (select count(*) from public.rides r
        where r.user_id = b.id and r.created_at >= now() - interval '30 days')::int as rides_30d,
      (select count(*) from public.rides r
        where r.user_id = b.id and r.status = 'ACCEPTED'
          and r.created_at >= now() - interval '30 days')::int as accepted_30d,
      (select round((coalesce(sum(o.duration_seconds), 0) / 3600.0)::numeric, 1)
        from public.online_sessions o
        where o.user_id = b.id and o.start_at >= now() - interval '30 days') as hours_30d,
      (select round(coalesce(sum(
           coalesce(r.fare_final, r.fare_estimated)
           / coalesce(nullif(r.fx_rate_eur, 0), 1)), 0)::numeric, 2)
        from public.rides r
        where r.user_id = b.id and r.status = 'ACCEPTED'
          and r.created_at >= now() - interval '30 days') as earnings_30d_eur,
      (select round(avg(r.hourly_rate / coalesce(nullif(r.fx_rate_eur, 0), 1))::numeric, 2)
        from public.rides r
        where r.user_id = b.id and r.hourly_rate > 0
          and r.created_at >= now() - interval '30 days') as avg_hourly_eur,
      (select count(*)::int from public.support_tickets st
        where st.user_id = b.id and st.status <> 'closed') as tickets_open
    from page b
    join public.profiles p on p.id = b.id
  )
  select jsonb_build_object(
    'total',  (select count(*) from base),
    'limit',  v_limit,
    'offset', v_offset,
    'rows',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.rn), '[]'::jsonb) from rows_out x)
  )
  into v_out;

  return v_out;
end;
$$;

revoke execute on function public.admin_drivers(text, text, boolean, text, int, int) from public;
grant  execute on function public.admin_drivers(text, text, boolean, text, int, int) to authenticated;

comment on function public.admin_drivers(text, text, boolean, text, int, int) is
  'Liste paginée des chauffeurs avec palier, quota et activité 30 j. Vérifie is_admin().';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. admin_driver(p_id) — la fiche d'un chauffeur
-- ═══════════════════════════════════════════════════════════════════════════
-- Tout ce qu'il faut pour répondre à un ticket : identité, abonnement, quota
-- réellement appliqué, véhicule, rythme sur 30 jours, dernières courses.
-- Les dernières courses sortent SANS adresse — plateforme, décision, montant,
-- taux, date. De quoi comprendre un litige de calcul, pas de suivre quelqu'un.
create or replace function public.admin_driver(p_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_driver: accès réservé aux administrateurs'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id',      p.id,
    'email',   coalesce(p.email, u.email),
    'name',    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    'phone',   p.phone,
    'country', p.country,
    'timezone', p.timezone,
    'created_at',      u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'is_admin',        coalesce(p.is_admin, false),

    'subscription', jsonb_build_object(
      'tier',       coalesce(p.subscription_tier, 'free'),
      'status',     p.subscription_status,
      'expires_at', p.subscription_expires_at,
      'product_id', p.subscription_product_id
    ),

    -- Le quota tel que le serveur l'applique : `daily_scans_count` n'a de sens
    -- qu'avec sa borne de journée. Si `daily_scans_day` est antérieur au début
    -- de la journée en cours, le compteur affiché est périmé et vaut 0 — c'est
    -- ce qui remplace une remise à zéro planifiée (cf. enforce_scan_quota).
    'quota', jsonb_build_object(
      'scans_today',        coalesce(p.daily_scans_count, 0),
      'day',                p.daily_scans_day,
      'stale',              p.daily_scans_day is null or p.daily_scans_day < date_trunc('day', now()),
      'credits',            coalesce(p.extra_scan_credits, 0),
      'welcome_credits',    coalesce(p.welcome_credits, 0),
      'welcome_expires_at', p.welcome_credits_expires_at
    ),

    'vehicle', jsonb_build_object(
      'make',      p.car_make,
      'model',     p.car_model,
      'year',      p.car_year,
      'fuel_type', p.fuel_type,
      'avg_cons',  p.avg_cons
    ),

    'online', jsonb_build_object(
      'flag',  p.is_online,
      'since', (select max(o.start_at) from public.online_sessions o
                 where o.user_id = p.id and o.end_at is null)
    ),

    'activity_30d', (
      select jsonb_build_object(
        'scans',    (select count(*) from public.scan_events e
                      where e.user_id = p.id and e.created_at >= now() - interval '30 days'),
        'rides',    (select count(*) from public.rides r
                      where r.user_id = p.id and r.created_at >= now() - interval '30 days'),
        'accepted', (select count(*) from public.rides r
                      where r.user_id = p.id and r.status = 'ACCEPTED'
                        and r.created_at >= now() - interval '30 days'),
        'hours',    (select round((coalesce(sum(o.duration_seconds), 0) / 3600.0)::numeric, 1)
                      from public.online_sessions o
                      where o.user_id = p.id and o.start_at >= now() - interval '30 days'),
        'earnings_eur', (select round(coalesce(sum(
                           coalesce(r.fare_final, r.fare_estimated)
                           / coalesce(nullif(r.fx_rate_eur, 0), 1)), 0)::numeric, 2)
                          from public.rides r
                          where r.user_id = p.id and r.status = 'ACCEPTED'
                            and r.created_at >= now() - interval '30 days')
      )
    ),

    -- Série journalière sur 30 jours : generate_series comble les jours vides,
    -- sinon la courbe saute les trous et ment sur le rythme.
    'daily', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb)
      from (
        select
          gs.d::date as day,
          (select count(*) from public.scan_events e
            where e.user_id = p.id and e.created_at >= gs.d and e.created_at < gs.d + interval '1 day')::int as scans,
          (select count(*) from public.rides r
            where r.user_id = p.id and r.created_at >= gs.d and r.created_at < gs.d + interval '1 day')::int as rides
        from generate_series(date_trunc('day', now() - interval '29 days'),
                             date_trunc('day', now()), interval '1 day') gs(d)
      ) d
    ),

    'recent_rides', (
      select coalesce(jsonb_agg(to_jsonb(r2) order by r2.created_at desc), '[]'::jsonb)
      from (
        select r.created_at, r.platform, r.status,
               r.fare_estimated, r.fare_final, r.currency,
               r.hourly_rate, r.km_rate, r.distance_km, r.duration_min
        from public.rides r
        where r.user_id = p.id
        order by r.created_at desc
        limit 20
      ) r2
    ),

    'tickets', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.last_message_at desc), '[]'::jsonb)
      from (
        select st.id, st.subject, st.status, st.created_at, st.last_message_at
        from public.support_tickets st
        where st.user_id = p.id
        order by st.last_message_at desc
        limit 20
      ) t
    )
  )
  into v
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_id;

  if v is null then
    raise exception 'admin_driver: chauffeur introuvable' using errcode = 'P0002';
  end if;

  return v;
end;
$$;

revoke execute on function public.admin_driver(uuid) from public;
grant  execute on function public.admin_driver(uuid) to authenticated;

comment on function public.admin_driver(uuid) is
  'Fiche complète d''un chauffeur pour le support. Vérifie is_admin() ; aucune adresse de course.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Depuis un compte NON admin, chacune doit échouer en 42501 :
--   select public.admin_live();
--   select public.admin_drivers();
--   select public.admin_driver('00000000-0000-0000-0000-000000000000');
--
-- Depuis un compte admin :
--   select jsonb_pretty(public.admin_live());
--   select jsonb_pretty(public.admin_drivers(p_limit => 5));
--   select jsonb_pretty(public.admin_driver((select id from public.profiles limit 1)));
