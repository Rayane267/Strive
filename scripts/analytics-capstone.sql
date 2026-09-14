-- ═══════════════════════════════════════════════════════════════════════════
-- Analyse Capstone — COHORTE : comptes a >= 50 courses depuis le 01/07/2026
-- ═══════════════════════════════════════════════════════════════════════════
-- C'est la version qui fait foi : le filtre ecarte les comptes ouverts puis
-- abandonnes (17, 20 et 25 courses), qui pesaient dans les moyennes sans rien
-- representer. Il deplace les resultats de moins de deux points.
--
-- ⚠️ FIABILITE (requete B8) : `scan_failures` n'existe que depuis le 08/08/2026
-- (migration 20260806). Un taux de reussite calcule sur une fenetre anterieure
-- compte des succes sans jamais compter les echecs correspondants, et sort donc
-- mecaniquement flatteur. Pour ce ratio SEULEMENT, borner a '2026-08-08'.

-- Cohorte : comptes avec au moins 50 courses scannees depuis le 01/07/2026
create temp view cohorte as
  select user_id from public.rides
  where created_at >= '2026-07-01'
  group by user_id having count(*) >= 50;

create temp view r as
  select ri.*, coalesce(ri.fare_final, ri.fare_estimated) as fare
  from public.rides ri
  join cohorte c on c.user_id = ri.user_id
  where ri.created_at >= '2026-07-01'
    and ri.duration_min > 0 and ri.distance_km > 0;

\echo '=== B0. Perimetre retenu vs ecarte ==='
select (select count(*) from cohorte) as comptes_retenus,
       (select count(*) from public.rides where created_at>='2026-07-01') as courses_avant_filtre,
       (select count(*) from r) as courses_apres_filtre,
       (select count(*) from public.rides where created_at>='2026-07-01')
       - (select count(*) from r) as courses_ecartees;

\echo '=== B1. Distributions ==='
select count(*) as n,
       round(avg(fare)::numeric,2) as tarif_moy,
       percentile_cont(0.5) within group (order by fare)::numeric(6,2) as tarif_med,
       round(avg(distance_km)::numeric,1) as km_moy,
       percentile_cont(0.5) within group (order by distance_km)::numeric(6,1) as km_med,
       round(avg(duration_min)::numeric,1) as min_moy,
       percentile_cont(0.5) within group (order by duration_min)::numeric(6,1) as min_med
from r;

\echo '=== B2. Rentabilite proposee (EUR/h, approche comprise) ==='
select percentile_cont(0.10) within group (order by fare/(duration_min/60.0))::numeric(6,1) as p10,
       percentile_cont(0.25) within group (order by fare/(duration_min/60.0))::numeric(6,1) as p25,
       percentile_cont(0.50) within group (order by fare/(duration_min/60.0))::numeric(6,1) as median,
       percentile_cont(0.75) within group (order by fare/(duration_min/60.0))::numeric(6,1) as p75,
       percentile_cont(0.90) within group (order by fare/(duration_min/60.0))::numeric(6,1) as p90
from r;

\echo '=== B3. Part sous seuils ==='
select round((count(*) filter (where fare/(duration_min/60.0) < 20))::numeric/count(*),3) as sous_20_eur_h,
       round((count(*) filter (where fare/(duration_min/60.0) < 25))::numeric/count(*),3) as sous_25_eur_h,
       round((count(*) filter (where fare/distance_km < 1.0))::numeric/count(*),3)        as sous_1_eur_km,
       round((count(*) filter (where fare/distance_km < 1.5))::numeric/count(*),3)        as sous_1_5_eur_km
from r;

\echo '=== B4. Plateformes ==='
select platform, count(*) as n,
       round((count(*)::numeric/sum(count(*)) over ()),3) as part,
       round(avg(fare)::numeric,2) as tarif_moy,
       percentile_cont(0.5) within group (order by fare/(duration_min/60.0))::numeric(6,1) as eur_h_med
from r group by 1 order by n desc;

\echo '=== B5. Carburant ==='
select p.fuel_type, count(*) as n,
       round(avg(r.fuel_cost)::numeric,2) as cout_moy,
       round(avg(r.fuel_cost/nullif(r.fare,0))::numeric,3) as part_du_tarif
from r join public.profiles p on p.id = r.user_id
where r.fuel_cost is not null and r.fuel_cost > 0
group by 1 order by n desc;

\echo '=== B6. Volume et rentabilite par heure ==='
select extract(hour from created_at)::int as heure, count(*) as volume,
       round(avg(fare/(duration_min/60.0))::numeric,1) as eur_h_moy
from r group by 1 order by 1;

\echo '=== B7. Intensite d usage ==='
select count(*) as scans, count(distinct created_at::date) as jours,
       round(count(*)::numeric/count(distinct created_at::date),1) as scans_par_jour_actif
from r group by user_id order by scans desc;

\echo '=== B8. Taux de reussite bout en bout (cohorte) ==='
select (select count(*) from r) as courses,
       (select count(*) from public.scan_failures sf join cohorte c on c.user_id=sf.user_id
        where sf.created_at>='2026-07-01') as echecs,
       (select count(*) from public.scan_failures sf join cohorte c on c.user_id=sf.user_id
        where sf.created_at>='2026-07-01'
          and sf.reason not in ('session_off','throttled','quota_reached')) as echecs_hors_normaux;

-- ═══════════════════════════════════════════════════════════════════════════
-- ANNEXE — requetes sans filtre de cohorte (premiere passe, conservees)
-- ═══════════════════════════════════════════════════════════════════════════
\set W '2026-07-01'

\echo '=== A1. Data quality (since July 1) ==='
select count(*) as n,
       count(*) filter (where distance_km is null or distance_km<=0) as dist_ko,
       count(*) filter (where duration_min is null or duration_min<=0) as duree_ko,
       count(*) filter (where fare_final is not null) as tarif_confirme,
       count(*) filter (where fuel_cost is not null) as avec_fuel,
       count(*) filter (where pickup_address is not null) as avec_pickup,
       count(*) filter (where destination_address is not null) as avec_dest,
       count(*) filter (where pickup_address is not null and destination_address is not null) as avec_2_adr
from rides where created_at >= :'W';

\echo '=== A2. Core distributions (valid rides only) ==='
select count(*) as n,
       round(avg(coalesce(fare_final,fare_estimated))::numeric,2) as tarif_moy,
       percentile_cont(0.5) within group (order by coalesce(fare_final,fare_estimated))::numeric(6,2) as tarif_med,
       min(coalesce(fare_final,fare_estimated))::numeric(6,2) as tarif_min,
       max(coalesce(fare_final,fare_estimated))::numeric(6,2) as tarif_max,
       round(avg(distance_km)::numeric,1) as km_moy,
       percentile_cont(0.5) within group (order by distance_km)::numeric(6,1) as km_med,
       round(avg(duration_min)::numeric,1) as min_moy,
       percentile_cont(0.5) within group (order by duration_min)::numeric(6,1) as min_med
from rides where created_at >= :'W' and distance_km > 0 and duration_min > 0;

\echo '=== A3. Hourly rate distribution, real drivers vs admin ==='
select case when p.is_admin then 'admin/dev' else 'chauffeur' end as segment,
       count(*) as n,
       percentile_cont(0.10) within group (order by coalesce(r.fare_final,r.fare_estimated)/(r.duration_min/60.0))::numeric(6,1) as p10,
       percentile_cont(0.25) within group (order by coalesce(r.fare_final,r.fare_estimated)/(r.duration_min/60.0))::numeric(6,1) as p25,
       percentile_cont(0.50) within group (order by coalesce(r.fare_final,r.fare_estimated)/(r.duration_min/60.0))::numeric(6,1) as median,
       percentile_cont(0.75) within group (order by coalesce(r.fare_final,r.fare_estimated)/(r.duration_min/60.0))::numeric(6,1) as p75,
       percentile_cont(0.90) within group (order by coalesce(r.fare_final,r.fare_estimated)/(r.duration_min/60.0))::numeric(6,1) as p90
from rides r join profiles p on p.id=r.user_id
where r.created_at >= :'W' and r.duration_min > 0 and r.distance_km > 0
group by 1;

\echo '=== A4. Share of offers below thresholds (all rides, valid) ==='
select count(*) as n,
       round((count(*) filter (where eur_h < 15))::numeric/count(*),3) as sous_15_eur_h,
       round((count(*) filter (where eur_h < 20))::numeric/count(*),3) as sous_20_eur_h,
       round((count(*) filter (where eur_h < 25))::numeric/count(*),3) as sous_25_eur_h,
       round((count(*) filter (where eur_km < 1.0))::numeric/count(*),3) as sous_1_eur_km,
       round((count(*) filter (where eur_km < 1.5))::numeric/count(*),3) as sous_1_5_eur_km
from (
  select coalesce(fare_final,fare_estimated)/(duration_min/60.0) as eur_h,
         coalesce(fare_final,fare_estimated)/distance_km as eur_km
  from rides where created_at >= :'W' and duration_min>0 and distance_km>0
) t;

\echo '=== A5. Histogram of hourly rate (5 EUR buckets) ==='
select width_bucket(eur_h, 0, 100, 20)*5 as tranche_eur_h_debut, count(*)
from (
  select coalesce(fare_final,fare_estimated)/(duration_min/60.0) as eur_h
  from rides where created_at >= :'W' and duration_min>0 and distance_km>0
) t group by 1 order by 1;

\echo '=== A6. Platform benchmark ==='
select platform, count(*) as n,
       round(avg(coalesce(fare_final,fare_estimated))::numeric,2) as tarif_moy,
       round(avg(coalesce(fare_final,fare_estimated)/(duration_min/60.0))::numeric,2) as eur_h_moy,
       percentile_cont(0.5) within group (order by coalesce(fare_final,fare_estimated)/(duration_min/60.0))::numeric(6,2) as eur_h_med,
       round(avg(coalesce(fare_final,fare_estimated)/distance_km)::numeric,2) as eur_km_moy,
       round(avg(distance_km)::numeric,1) as km_moy,
       round(avg(duration_min)::numeric,1) as min_moy
from rides where created_at >= :'W' and duration_min>0 and distance_km>0
group by 1 order by n desc;

\echo '=== A7. Fuel cost share of fare ==='
select p.fuel_type, count(*) as n,
       round(avg(r.fuel_cost)::numeric,2) as cout_moy,
       round(avg(r.fuel_cost/nullif(coalesce(r.fare_final,r.fare_estimated),0))::numeric,3) as part_du_tarif
from rides r join profiles p on p.id=r.user_id
where r.created_at >= :'W' and r.fuel_cost is not null and r.fuel_cost > 0
group by 1 order by n desc;

\echo '=== A8. Accepted vs declined: are drivers picking the good ones? ==='
select case when p.is_admin then 'admin/dev' else 'chauffeur' end as segment,
       r.status, count(*) as n,
       round(avg(coalesce(r.fare_final,r.fare_estimated)/(r.duration_min/60.0))::numeric,1) as eur_h_moy,
       round(avg(coalesce(r.fare_final,r.fare_estimated)/r.distance_km)::numeric,2) as eur_km_moy,
       round(avg(coalesce(r.fare_final,r.fare_estimated))::numeric,2) as tarif_moy,
       round(avg(r.distance_km)::numeric,1) as km_moy
from rides r join profiles p on p.id=r.user_id
where r.created_at >= :'W' and r.duration_min>0 and r.distance_km>0
group by 1,2 order by 1,2;

\echo '=== A9. Volume and quality by hour of day (all) ==='
select extract(hour from created_at)::int as heure, count(*) as volume,
       round(avg(coalesce(fare_final,fare_estimated)/(duration_min/60.0))::numeric,1) as eur_h_moy
from rides where created_at >= :'W' and duration_min>0 and distance_km>0
group by 1 order by 1;
