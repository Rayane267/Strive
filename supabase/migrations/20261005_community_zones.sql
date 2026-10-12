-- ════════════════════════════════════════════════════════════════════════════
-- Carte communautaire — les zones de TOUS les chauffeurs, agrégées en base
--
-- POURQUOI UNE FONCTION. Les courses des autres chauffeurs ne quittent jamais
-- la base : RLS les réserve à leur propriétaire, et c'est très bien. Seuls des
-- AGRÉGATS sortent — nombre de courses, sommes de tarifs, de kilomètres et
-- d'heures par case de grille. Aucune adresse, aucun identifiant, aucune heure.
--
-- ANONYMAT. Une case n'est renvoyée que si elle cumule au moins 5 courses de
-- 3 chauffeurs distincts. En dessous, une case pourrait désigner le trajet d'une
-- seule personne. La maille la plus fine reste 250 m, au-dessus de la précision
-- stockée (~100 m, cf. 20261001_ride_coords.sql).
--
-- GRILLE. Même calcul que `buildZones` (src/utils/zones.ts) : i = ⌊lat / dLat⌋,
-- j = ⌊lon / dLon⌋, dLon dépendant de `p_ref_lat`. Le client reconstruit les
-- coins depuis (i, j) : la géométrie ne voyage pas.
--
-- MONNAIE. Les tarifs sont ramenés à l'euro au taux figé du scan
-- (`fx_rate_eur`, null = course en euros). Le client convertit vers la devise du
-- chauffeur, comme pour ses propres totaux.
--
-- TOUTES LES COURSES SCANNÉES comptent, acceptées ou non : la carte dit ce que
-- les plateformes PROPOSENT dans une zone, pas ce qu'un chauffeur a pris.
--
-- RÉSERVÉ AU PLAN PLUS, vérifié ici par `effective_tier` : masquer l'onglet
-- côté app ne protège rien.
-- ════════════════════════════════════════════════════════════════════════════

-- Lecture par emprise + fenêtre : sans index, chaque ouverture de la carte
-- parcourt toute la table.
create index if not exists rides_pickup_coords_idx
  on public.rides (pickup_lat, pickup_lon, created_at)
  where pickup_lat is not null;

create or replace function public.community_zones(
  p_min_lat numeric,
  p_min_lon numeric,
  p_max_lat numeric,
  p_max_lon numeric,
  p_size_m  integer,
  p_ref_lat numeric,
  p_days    integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_days  integer := least(greatest(coalesce(p_days, 90), 1), 90);
  v_dlat  double precision;
  v_dlon  double precision;
  v_cells jsonb;
  v_rides integer;
  v_drivers integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if public.effective_tier(v_uid) = 'free' then
    raise exception 'plus_required' using errcode = '42501';
  end if;

  -- Mêmes mailles que ZONE_SIZES_M : une maille arbitraire permettrait de
  -- découper finement une zone pour isoler une course.
  if p_size_m not in (250, 500, 1000, 2000, 4000, 8000) then
    raise exception 'invalid_size' using errcode = '22023';
  end if;
  -- Emprise bornée (~ une région) : l'appel ne doit pas balayer l'Europe.
  if p_max_lat - p_min_lat > 3 or p_max_lon - p_min_lon > 4
     or p_max_lat <= p_min_lat or p_max_lon <= p_min_lon then
    raise exception 'invalid_bounds' using errcode = '22023';
  end if;

  v_dlat := p_size_m / 111320.0;
  v_dlon := p_size_m / (111320.0 * greatest(0.1, cos(radians(p_ref_lat::double precision))));

  with src as (
    select r.user_id,
           r.pickup_lat::double precision as lat,
           r.pickup_lon::double precision as lon,
           -- Valeur pivot en euros ; les tarifs absurdes sont écartés pour
           -- qu'un scan raté ne colore pas toute une zone.
           coalesce(r.fare_final, r.fare_estimated)::double precision
             / coalesce(nullif(r.fx_rate_eur, 0), 1)::double precision as fare_eur,
           r.distance_km::double precision as km,
           r.duration_min::double precision as minutes,
           (regexp_match(r.pickup_address, '(\d{4,5}(?:-\d{3})?)\s+([^\d,]+)')) as pc
      from public.rides r
     where r.pickup_lat is not null
       and r.created_at > now() - make_interval(days => v_days)
       and r.pickup_lat between p_min_lat and p_max_lat
       and r.pickup_lon between p_min_lon and p_max_lon
       and coalesce(r.fare_final, r.fare_estimated) between 1 and 1000
  ),
  cells as (
    select floor(lat / v_dlat)::bigint as i,
           floor(lon / v_dlon)::bigint as j,
           count(*)                     as rides,
           count(distinct user_id)      as drivers,
           sum(fare_eur) filter (where km > 0)            as fare_km,
           sum(km)       filter (where km > 0)            as km,
           sum(fare_eur) filter (where minutes > 0)       as fare_time,
           sum(minutes)  filter (where minutes > 0) / 60.0 as hours,
           mode() within group (order by pc[1] || ' ' || btrim(pc[2])) as label
      from src
     group by 1, 2
    having count(*) >= 5 and count(distinct user_id) >= 3
     order by count(*) desc
     limit 600
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'i', i, 'j', j, 'rides', rides, 'drivers', drivers,
           'fare_km', round(fare_km::numeric, 2), 'km', round(km::numeric, 2),
           'fare_time', round(fare_time::numeric, 2), 'hours', round(hours::numeric, 3),
           'label', label)), '[]'::jsonb)
    into v_cells
    from cells;

  select count(*), count(distinct user_id)
    into v_rides, v_drivers
    from public.rides r
   where r.pickup_lat is not null
     and r.created_at > now() - make_interval(days => v_days)
     and r.pickup_lat between p_min_lat and p_max_lat
     and r.pickup_lon between p_min_lon and p_max_lon;

  return jsonb_build_object(
    'cells', v_cells,
    'rides', v_rides,
    -- Sous 3, le total ne se montre pas : il dirait combien de personnes
    -- roulent dans un coin isolé.
    'drivers', case when v_drivers >= 3 then v_drivers else null end
  );
end;
$$;

revoke all on function public.community_zones(numeric, numeric, numeric, numeric, integer, numeric, integer) from public, anon;
grant execute on function public.community_zones(numeric, numeric, numeric, numeric, integer, numeric, integer) to authenticated;

comment on function public.community_zones(numeric, numeric, numeric, numeric, integer, numeric, integer) is
  'Zones agregees de tous les chauffeurs (plan Plus). Cases d au moins 5 courses '
  'de 3 chauffeurs, tarifs en EUR au taux du scan. Voir src/utils/zones.ts.';

-- ════════════════════════════════════════════════════════════════════════════
-- Vérification manuelle
--
--   -- En tant que compte free :
--   select community_zones(48.8, 2.2, 48.9, 2.5, 1000, 48.9);
--   → ERROR: plus_required
--
--   -- En tant que compte Plus :
--   select jsonb_array_length(community_zones(48.8, 2.2, 48.9, 2.5, 1000, 48.9)->'cells');
--   select community_zones(48.8, 2.2, 48.9, 2.5, 300, 48.9);
--   → ERROR: invalid_size
-- ════════════════════════════════════════════════════════════════════════════
