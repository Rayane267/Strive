-- ════════════════════════════════════════════════════════════════════════════
-- Carte en direct — où ça demande MAINTENANT
--
-- Remplace `community_zones` (90 jours, grille) : la carte commune ne montre
-- plus une moyenne, mais les offres scannées par tous les chauffeurs dans les
-- dernières minutes, regroupées en taches de chaleur approximatives.
--
-- TACHES. Les départs récents sont rassemblés par secteurs d'environ 600 m ;
-- chaque secteur renvoie le CENTRE MOYEN de ses départs (arrondi à ~100 m), pas
-- les départs eux-mêmes. L'app y dessine un halo flou : la zone est volontairement
-- approximative.
--
-- ANONYMAT. En direct, un point dirait où se trouve quelqu'un en ce moment. Une
-- tache n'est donc renvoyée qu'avec au moins 3 offres venant d'au moins 2
-- chauffeurs distincts, et ne porte ni identifiant, ni adresse, ni heure.
--
-- RÉSERVÉ AU PLAN PLUS, vérifié ici par `effective_tier`.
-- ════════════════════════════════════════════════════════════════════════════

-- La lecture porte désormais sur les toutes dernières minutes : l'index part
-- de `created_at`.
create index if not exists rides_live_coords_idx
  on public.rides (created_at, pickup_lat, pickup_lon)
  where pickup_lat is not null;

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
  v_uid     uuid := auth.uid();
  v_minutes integer := least(greatest(coalesce(p_minutes, 30), 5), 60);
  -- ~600 m : assez large pour qu'une tache réunisse plusieurs chauffeurs,
  -- assez fin pour distinguer une gare du quartier d'à côté.
  v_dlat    double precision := 600 / 111320.0;
  v_dlon    double precision;
  v_spots   jsonb;
  v_rides   integer;
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

  v_dlon := 600 / (111320.0 * greatest(0.1, cos(radians(((p_min_lat + p_max_lat) / 2)::double precision))));

  with src as (
    select r.user_id,
           r.pickup_lat::double precision as lat,
           r.pickup_lon::double precision as lon,
           coalesce(r.fare_final, r.fare_estimated)::double precision
             / coalesce(nullif(r.fx_rate_eur, 0), 1)::double precision as fare_eur,
           r.distance_km::double precision as km
      from public.rides r
     where r.pickup_lat is not null
       and r.created_at > now() - make_interval(mins => v_minutes)
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
    having count(*) >= 3 and count(distinct user_id) >= 2
     order by count(*) desc
     limit 300
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lat', lat, 'lon', lon, 'rides', rides,
           'fare_km', round(fare_km::numeric, 2), 'km', round(km::numeric, 2))), '[]'::jsonb),
         coalesce(sum(rides), 0)
    into v_spots, v_rides
    from spots;

  return jsonb_build_object('spots', v_spots, 'rides', v_rides, 'minutes', v_minutes);
end;
$$;

revoke all on function public.community_live(numeric, numeric, numeric, numeric, integer) from public, anon;
grant execute on function public.community_live(numeric, numeric, numeric, numeric, integer) to authenticated;

comment on function public.community_live(numeric, numeric, numeric, numeric, integer) is
  'Taches de demande en direct (plan Plus) : offres des N dernieres minutes, '
  'centres moyens arrondis, au moins 3 offres de 2 chauffeurs par tache.';

-- L'ancienne carte commune sur 90 jours n'est plus appelée.
drop function if exists public.community_zones(numeric, numeric, numeric, numeric, integer, numeric, integer);

-- ════════════════════════════════════════════════════════════════════════════
-- Vérification manuelle
--
--   -- Compte free :
--   select community_live(48.8, 2.2, 48.9, 2.5);
--   → ERROR: plus_required
--
--   -- Compte Plus :
--   select community_live(48.8, 2.2, 48.9, 2.5, 30);
--   → {"spots": [...], "rides": n, "minutes": 30}
-- ════════════════════════════════════════════════════════════════════════════
