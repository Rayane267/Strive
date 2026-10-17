-- ═══════════════════════════════════════════════════════════════════════════
-- Signalements de la carte, comme Waze : police, accident, danger, bouchon,
-- travaux
-- ═══════════════════════════════════════════════════════════════════════════
-- Un chauffeur signale ce qu'il voit, à sa position ; les suivants confirment
-- (« Toujours là ») ou infirment (« Plus là »).
--
-- DURÉE DE VIE. Un signalement s'éteint seul : 30 min pour un bouchon, 24 h
-- pour des travaux, 1 h pour le reste. Chaque « Toujours là » la relance depuis
-- maintenant ; deux « Plus là » le retirent. Un chauffeur ne vote qu'une fois
-- par signalement, et pas sur le sien — il peut en revanche le retirer.
--
-- DOUBLONS. Signaler ce qui est déjà signalé à moins de 150 m, même catégorie,
-- compte comme une confirmation : dix chauffeurs devant le même accident ne
-- doivent pas poser dix épingles.
--
-- POLICE ET LOI (article L130-11 du Code de la route). Le préfet peut interdire
-- de rediffuser les signalements de contrôle dans une zone : 2 h au plus pour
-- un dépistage d'alcool ou de stupéfiants, 12 h pour les autres opérations.
-- `police_report_blackouts` porte ces zones ; tant qu'une zone est active, les
-- signalements « police » qui y tombent ne sont plus servis. Saisie à la main
-- pour l'instant, depuis l'éditeur SQL :
--
--   insert into public.police_report_blackouts (lat, lon, radius_m, ends_at, note)
--   values (48.8566, 2.3522, 2000, now() + interval '2 hours', 'Arrêté n° …');
--
-- DONNÉES PERSONNELLES. Un signalement est une position d'un chauffeur à un
-- instant : il est supprimé deux jours après son expiration (purge faite à
-- chaque nouveau signalement), et `user_id` part avec le compte.
--
-- Les trois tables n'ont AUCUNE policy : on n'y touche que par les fonctions
-- ci-dessous.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.road_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  kind          text not null check (kind in ('police', 'accident', 'danger', 'traffic', 'roadworks')),
  lat           double precision not null check (lat between -90 and 90),
  lon           double precision not null check (lon between -180 and 180),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  confirmations int not null default 0,
  dismissals    int not null default 0,
  removed_at    timestamptz
);

create index if not exists idx_road_reports_geo on public.road_reports (lat, lon);
create index if not exists idx_road_reports_expires on public.road_reports (expires_at);
create index if not exists idx_road_reports_user_created on public.road_reports (user_id, created_at desc);

create table if not exists public.road_report_votes (
  report_id   uuid not null references public.road_reports(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  still_there boolean not null,
  voted_at    timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table if not exists public.police_report_blackouts (
  id         uuid primary key default gen_random_uuid(),
  lat        double precision not null,
  lon        double precision not null,
  radius_m   int not null check (radius_m between 100 and 20000),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  note       text,
  created_at timestamptz not null default now(),
  -- 12 h : le plafond légal le plus long. Une zone mal saisie ne peut donc pas
  -- couper la police indéfiniment.
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);

create index if not exists idx_police_blackouts_ends on public.police_report_blackouts (ends_at);

alter table public.road_reports enable row level security;
alter table public.road_report_votes enable row level security;
alter table public.police_report_blackouts enable row level security;

-- Distance en mètres, approximation équirectangulaire : à l'échelle de
-- quelques kilomètres l'écart avec le grand cercle est négligeable.
create or replace function public.road_report_distance_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000 * sqrt(
    power(radians(lat2 - lat1), 2)
    + power(cos(radians((lat1 + lat2) / 2)) * radians(lon2 - lon1), 2)
  );
$$;

create or replace function public.road_report_lifetime(p_kind text)
returns interval
language sql
immutable
as $$
  select case p_kind
    when 'traffic'   then interval '30 minutes'
    when 'roadworks' then interval '24 hours'
    else interval '1 hour'
  end;
$$;

-- ── Signaler ────────────────────────────────────────────────────────────────
create or replace function public.create_road_report(
  p_kind text,
  p_lat  double precision,
  p_lon  double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  v_recent   int;
  v_existing public.road_reports;
  v_id       uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('police', 'accident', 'danger', 'traffic', 'roadworks') then
    raise exception 'road_report_bad_kind' using errcode = 'P0001';
  end if;

  delete from public.road_reports where expires_at < now() - interval '2 days';

  -- Dix par heure : largement assez pour un chauffeur qui roule, trop peu pour
  -- couvrir une ville d'épingles inventées.
  select count(*) into v_recent
    from public.road_reports
   where user_id = uid and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'road_report_rate_limited' using errcode = 'P0001';
  end if;

  -- Le cadre en degrés (~220 m) laisse l'index trier avant le calcul exact.
  select * into v_existing
    from public.road_reports r
   where r.kind = p_kind
     and r.removed_at is null
     and r.expires_at > now()
     and r.lat between p_lat - 0.002 and p_lat + 0.002
     and r.lon between p_lon - 0.003 and p_lon + 0.003
     and public.road_report_distance_m(r.lat, r.lon, p_lat, p_lon) <= 150
   order by r.created_at desc
   limit 1;

  if found then
    if v_existing.user_id is distinct from uid then
      insert into public.road_report_votes (report_id, user_id, still_there)
      values (v_existing.id, uid, true)
      on conflict (report_id, user_id) do nothing;
      if found then
        update public.road_reports
           set confirmations = confirmations + 1,
               expires_at    = greatest(expires_at, now() + public.road_report_lifetime(kind))
         where id = v_existing.id;
      end if;
    end if;
    return jsonb_build_object('id', v_existing.id, 'merged', true);
  end if;

  insert into public.road_reports (user_id, kind, lat, lon, expires_at)
  values (uid, p_kind, p_lat, p_lon, now() + public.road_report_lifetime(p_kind))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'merged', false);
end;
$$;

-- ── Toujours là / Plus là ───────────────────────────────────────────────────
create or replace function public.vote_road_report(
  p_report_id   uuid,
  p_still_there boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_report  public.road_reports;
  v_removed boolean;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  select * into v_report from public.road_reports where id = p_report_id for update;
  if not found or v_report.removed_at is not null or v_report.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  -- Son propre signalement : on ne le confirme pas soi-même, mais on peut le
  -- retirer.
  if v_report.user_id = uid then
    if p_still_there then
      return jsonb_build_object('ok', false, 'reason', 'own_report');
    end if;
    update public.road_reports set removed_at = now() where id = p_report_id;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;

  insert into public.road_report_votes (report_id, user_id, still_there)
  values (p_report_id, uid, p_still_there)
  on conflict (report_id, user_id) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_voted');
  end if;

  if p_still_there then
    update public.road_reports
       set confirmations = confirmations + 1,
           expires_at    = greatest(expires_at, now() + public.road_report_lifetime(kind))
     where id = p_report_id;
    return jsonb_build_object('ok', true, 'removed', false);
  end if;

  update public.road_reports
     set dismissals = dismissals + 1,
         removed_at = case when dismissals + 1 >= 2 then now() else removed_at end
   where id = p_report_id
  returning removed_at is not null into v_removed;

  return jsonb_build_object('ok', true, 'removed', v_removed);
end;
$$;

-- ── Ce que la carte affiche ─────────────────────────────────────────────────
-- Emprise plafonnée comme celle du direct (3° × 4°) : au-delà, rien ne sort,
-- ce qui suffit à empêcher d'aspirer le pays d'un coup.
create or replace function public.road_reports_in_view(
  p_min_lat double precision,
  p_min_lon double precision,
  p_max_lat double precision,
  p_max_lon double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',            r.id,
           'kind',          r.kind,
           'lat',           r.lat,
           'lon',           r.lon,
           'created_at',    r.created_at,
           'expires_at',    r.expires_at,
           'confirmations', r.confirmations,
           'mine',          coalesce(r.user_id = auth.uid(), false),
           'voted',         exists (
                              select 1 from public.road_report_votes v
                               where v.report_id = r.id and v.user_id = auth.uid()
                            )
         ) order by r.created_at desc), '[]'::jsonb)
    from (
      select *
        from public.road_reports r
       where r.removed_at is null
         and r.expires_at > now()
         and p_max_lat - p_min_lat <= 3
         and p_max_lon - p_min_lon <= 4
         and r.lat between p_min_lat and p_max_lat
         and r.lon between p_min_lon and p_max_lon
         and not (
           r.kind = 'police'
           and exists (
             select 1 from public.police_report_blackouts b
              where now() between b.starts_at and b.ends_at
                and public.road_report_distance_m(b.lat, b.lon, r.lat, r.lon) <= b.radius_m
           )
         )
       order by r.created_at desc
       limit 200
    ) r;
$$;

revoke all on function public.create_road_report(text, double precision, double precision) from public, anon;
revoke all on function public.vote_road_report(uuid, boolean) from public, anon;
revoke all on function public.road_reports_in_view(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.create_road_report(text, double precision, double precision) to authenticated;
grant execute on function public.vote_road_report(uuid, boolean) to authenticated;
grant execute on function public.road_reports_in_view(double precision, double precision, double precision, double precision) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Console admin : page « Signalements »
-- ═══════════════════════════════════════════════════════════════════════════
-- Masquer la police dans une zone à réception d'un arrêté, lever un masquage
-- avant son terme, retirer un signalement abusif. Toutes vérifient is_admin().

create or replace function public.admin_road_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'blackouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        b.id,
               'lat',       b.lat,
               'lon',       b.lon,
               'radius_m',  b.radius_m,
               'starts_at', b.starts_at,
               'ends_at',   b.ends_at,
               'note',      b.note,
               'active',    now() between b.starts_at and b.ends_at
             ) order by b.ends_at desc)
        from public.police_report_blackouts b
       where b.ends_at > now() - interval '7 days'
    ), '[]'::jsonb),
    'by_kind', coalesce((
      select jsonb_agg(jsonb_build_object('kind', s.kind, 'active', s.active, 'today', s.today))
        from (
          select kind,
                 count(*) filter (where removed_at is null and expires_at > now()) as active,
                 count(*) filter (where created_at >= date_trunc('day', now())) as today
            from public.road_reports
           group by kind
        ) s
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',            r.id,
               'kind',          r.kind,
               'lat',           r.lat,
               'lon',           r.lon,
               'created_at',    r.created_at,
               'expires_at',    r.expires_at,
               'confirmations', r.confirmations,
               'dismissals',    r.dismissals,
               'removed',       r.removed_at is not null,
               'live',          r.removed_at is null and r.expires_at > now()
             ) order by r.created_at desc)
        from (select * from public.road_reports order by created_at desc limit 50) r
    ), '[]'::jsonb)
  );
end;
$$;

-- `p_minutes` plutôt qu'un choix figé : l'arrêté fixe la durée, la console
-- propose 2 h et 12 h mais accepte toute valeur sous le plafond légal.
create or replace function public.admin_create_police_blackout(
  p_lat      double precision,
  p_lon      double precision,
  p_radius_m int,
  p_minutes  int,
  p_note     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lon is null
     or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'blackout_bad_position' using errcode = 'P0001';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 720 then
    raise exception 'blackout_bad_duration' using errcode = 'P0001';
  end if;

  insert into public.police_report_blackouts (lat, lon, radius_m, ends_at, note)
  values (p_lat, p_lon, p_radius_m, now() + make_interval(mins => p_minutes), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_end_police_blackout(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = 'P0001';
  end if;
  update public.police_report_blackouts
     set ends_at = greatest(starts_at + interval '1 second', now())
   where id = p_id and ends_at > now();
end;
$$;

create or replace function public.admin_remove_road_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = 'P0001';
  end if;
  update public.road_reports set removed_at = now() where id = p_id and removed_at is null;
end;
$$;

revoke all on function public.admin_road_reports() from public, anon;
revoke all on function public.admin_create_police_blackout(double precision, double precision, int, int, text) from public, anon;
revoke all on function public.admin_end_police_blackout(uuid) from public, anon;
revoke all on function public.admin_remove_road_report(uuid) from public, anon;
grant execute on function public.admin_road_reports() to authenticated;
grant execute on function public.admin_create_police_blackout(double precision, double precision, int, int, text) to authenticated;
grant execute on function public.admin_end_police_blackout(uuid) to authenticated;
grant execute on function public.admin_remove_road_report(uuid) to authenticated;
