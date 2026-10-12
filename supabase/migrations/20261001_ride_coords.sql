-- ════════════════════════════════════════════════════════════════════════════
-- Coordonnées GPS de départ / destination par course — carte des zones
--
-- POURQUOI. Le scan géocode DÉJÀ les deux adresses (TomTom, pour calculer
-- l'itinéraire), puis jetait les coordonnées. Les garder ne coûte aucun appel
-- de plus, et c'est ce qui permet de montrer au chauffeur OÙ ses courses paient
-- le mieux.
--
-- PRÉCISION. 3 décimales (~100 m). La carte regroupe les départs en zones
-- dont la taille suit le zoom, 250 m au plus fin : rien ne sert en dessous,
-- donc rien n'est gardé en dessous. Les coordonnées n'exposent rien de plus que
-- `pickup_address` / `destination_address`, déjà stockées, dont elles dérivent.
--
-- Le client arrondit avant l'envoi, et le type le garantit quand même :
-- `numeric(6, 3)` arrondit à l'écriture. Un build qui enverrait plus précis ne
-- stockerait pas plus précis.
--
-- RGPD. Même rétention que les adresses : effacées au bout de 12 mois avec
-- elles (cf. 20260529_ride_addresses.sql, purge redéfinie plus bas).
--
-- null = course antérieure, ou scan dont l'itinéraire n'a pas été calculé
-- (TomTom injoignable, adresse illisible). Pas de rattrapage ici.
--
-- ⚠️ À DÉPLOYER AVANT le build qui écrit ces colonnes. PostgREST refuse un
--    insert qui nomme une colonne inconnue : sans elles, chaque course partirait
--    au journal et y resterait.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.rides
  add column if not exists pickup_lat numeric(6, 3),
  add column if not exists pickup_lon numeric(6, 3),
  add column if not exists dest_lat   numeric(6, 3),
  add column if not exists dest_lon   numeric(6, 3);

alter table public.rides
  drop constraint if exists rides_coords_check;

-- Une paire est complète ou absente : une latitude sans longitude ne se place
-- nulle part sur une carte.
alter table public.rides
  add constraint rides_coords_check
  check (
        (pickup_lat is null) = (pickup_lon is null)
    and (dest_lat   is null) = (dest_lon   is null)
    and (pickup_lat is null or pickup_lat between -90  and 90)
    and (pickup_lon is null or pickup_lon between -180 and 180)
    and (dest_lat   is null or dest_lat   between -90  and 90)
    and (dest_lon   is null or dest_lon   between -180 and 180)
  );

comment on column public.rides.pickup_lat is
  'Latitude du depart, arrondie a 3 decimales (~100 m). Effacee avec les '
  'adresses apres 12 mois.';

-- ─── Rétention 12 mois — les coordonnées partent avec les adresses ──────────
create or replace function public.purge_old_ride_addresses()
returns void
language sql
security definer
set search_path = public
as $$
  update public.rides
     set pickup_address      = null,
         destination_address = null,
         pickup_lat          = null,
         pickup_lon          = null,
         dest_lat            = null,
         dest_lon            = null
   where created_at < now() - interval '12 months'
     and (   pickup_address is not null or destination_address is not null
          or pickup_lat     is not null or dest_lat            is not null);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Vérification manuelle
--
--   update rides set pickup_lat = 48.8566 where id = '<un id sans coords>';
--   → ERROR: new row violates check constraint "rides_coords_check"
--
--   update rides set pickup_lat = 48.8566, pickup_lon = 2.3522 where id = '<id>';
--   select pickup_lat, pickup_lon from rides where id = '<id>';
--   → 48.857 | 2.352
--
--   select count(*) filter (where pickup_lat is not null) as avec,
--          count(*) as total
--     from rides where created_at > now() - interval '1 day';
-- ════════════════════════════════════════════════════════════════════════════
