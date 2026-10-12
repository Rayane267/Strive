-- ════════════════════════════════════════════════════════════════════════════
-- Réglages de la carte en direct — modifiables sans nouvelle version de l'app
--
-- Une seule ligne, éditée à la main dans le dashboard Supabase au fur et à
-- mesure que la base de chauffeurs grossit :
--
--   window_minutes  fenêtre du direct (scans des N dernières minutes)
--   min_rides       scans minimum pour qu'une zone apparaisse
--   min_drivers     chauffeurs distincts minimum par zone (anonymat : jamais
--                   moins de 2, sinon une zone dirait où se trouve UNE personne)
--   hot_rides       scans à partir desquels une zone est pleinement rouge
--   cell_m          taille des secteurs regroupés en une zone, en mètres
--
-- `community_live` lit cette ligne à chaque appel et renvoie `hot_rides` à
-- l'app, qui en tire l'intensité des couleurs.
--
-- La politique de confidentialité reste volontairement générique (« dernières
-- minutes », « plusieurs chauffeurs ») : ces réglages bougent sans la toucher.
-- Seule limite : `min_drivers` ne descend jamais sous 2, ce qu'elle promet.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.live_map_settings (
  -- Clé constante : la table ne peut contenir qu'une ligne.
  id             boolean primary key default true check (id),
  window_minutes integer not null default 30  check (window_minutes between 5 and 120),
  min_rides      integer not null default 3   check (min_rides between 2 and 50),
  min_drivers    integer not null default 2   check (min_drivers between 2 and 20),
  hot_rides      integer not null default 10  check (hot_rides between 3 and 500),
  cell_m         integer not null default 600 check (cell_m between 200 and 3000),
  updated_at     timestamptz not null default now(),
  check (hot_rides > min_rides)
);

insert into public.live_map_settings (id) values (true) on conflict (id) do nothing;

-- Lue uniquement par `community_live` (SECURITY DEFINER) : aucun accès client.
alter table public.live_map_settings enable row level security;
revoke all on public.live_map_settings from anon, authenticated;

create or replace function public.touch_live_map_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists live_map_settings_touch on public.live_map_settings;
create trigger live_map_settings_touch
  before update on public.live_map_settings
  for each row execute function public.touch_live_map_settings();

comment on table public.live_map_settings is
  'Reglages de la carte en direct (une ligne). Modifiables a chaud depuis le '
  'dashboard ; voir 20261008_live_map_settings.sql.';

-- ─── community_live lit ses réglages dans la table ──────────────────────────
-- Même signature : `p_minutes` est conservé pour les builds déjà sortis, mais
-- ignoré — la fenêtre vient de la table.
create or replace function public.community_live(
  p_min_lat numeric,
  p_min_lon numeric,
  p_max_lat numeric,
  p_max_lon numeric,
  p_minutes integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_set   public.live_map_settings;
  v_dlat  double precision;
  v_dlon  double precision;
  v_spots jsonb;
  v_rides integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if public.effective_tier(v_uid) = 'free' then
    raise exception 'plus_required' using errcode = '42501';
  end if;
  if p_max_lat - p_min_lat > 3 or p_max_lon - p_min_lon > 4
     or p_max_lat <= p_min_lat or p_max_lon <= p_min_lon then
    raise exception 'invalid_bounds' using errcode = '22023';
  end if;

  select * into v_set from public.live_map_settings where id;
  -- Filet si la ligne a été supprimée : les valeurs par défaut de la table.
  if not found then
    v_set := row(true, 30, 3, 2, 10, 600, now())::public.live_map_settings;
  end if;

  v_dlat := v_set.cell_m / 111320.0;
  v_dlon := v_set.cell_m / (111320.0 * greatest(0.1, cos(radians(((p_min_lat + p_max_lat) / 2)::double precision))));

  with src as (
    select r.user_id,
           r.pickup_lat::double precision as lat,
           r.pickup_lon::double precision as lon,
           coalesce(r.fare_final, r.fare_estimated)::double precision
             / coalesce(nullif(r.fx_rate_eur, 0), 1)::double precision as fare_eur,
           r.distance_km::double precision as km
      from public.rides r
     where r.pickup_lat is not null
       and r.created_at > now() - make_interval(mins => v_set.window_minutes)
       and r.pickup_lat between p_min_lat and p_max_lat
       and r.pickup_lon between p_min_lon and p_max_lon
       and coalesce(r.fare_final, r.fare_estimated) between 1 and 1000
  ),
  spots as (
    select round(avg(lat)::numeric, 3) as lat,
           round(avg(lon)::numeric, 3) as lon,
           count(*)                    as rides,
           sum(fare_eur) filter (where km > 0) as fare_km,
           sum(km)       filter (where km > 0) as km
      from src
     group by floor(lat / v_dlat), floor(lon / v_dlon)
    having count(*) >= v_set.min_rides
       and count(distinct user_id) >= greatest(2, v_set.min_drivers)
     order by count(*) desc
     limit 300
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lat', lat, 'lon', lon, 'rides', rides,
           'fare_km', round(fare_km::numeric, 2), 'km', round(km::numeric, 2))), '[]'::jsonb),
         coalesce(sum(rides), 0)
    into v_spots, v_rides
    from spots;

  return jsonb_build_object(
    'spots', v_spots,
    'rides', v_rides,
    'minutes', v_set.window_minutes,
    'min_rides', v_set.min_rides,
    'hot_rides', v_set.hot_rides
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Utilisation
--
--   update live_map_settings set hot_rides = 15, window_minutes = 20;
--   select community_live(48.8, 2.2, 48.9, 2.5);
--   → {..., "minutes": 20, "hot_rides": 15}
--
--   update live_map_settings set min_drivers = 1;
--   → ERROR: violates check constraint (anonymat : 2 minimum)
-- ════════════════════════════════════════════════════════════════════════════
