-- ═══════════════════════════════════════════════════════════════════════════
-- skip_duplicate_ride : dédoublonner sur l'identité du scan, plus sur une
-- fenêtre de 90 secondes
-- ═══════════════════════════════════════════════════════════════════════════
-- La version du 27 juillet reconnaissait un doublon à « même plateforme + même
-- tarif + même distance, inséré il y a moins de 90 s », en pariant que « deux
-- offres distinctes n'ont jamais le même tarif au centime ET la même distance ».
-- Deux choses ont invalidé ce pari.
--
-- 1. Le pari est faux. Uber repropose une course refusée quelques secondes plus
--    tard, et deux trajets courts d'une même zone sortent régulièrement au même
--    prix pour la même distance. La seconde offre était écartée en silence :
--    `createRide` rend NULL, l'app croit avoir réussi, la course n'existe pas.
--    Aucune erreur, aucune trace — le chauffeur voyait le verdict et ne
--    retrouvait rien dans son dashboard.
--
-- 2. La fenêtre ne veut plus rien dire. Depuis 20260816_rides_scan_ts.sql,
--    `created_at` porte l'heure du SCAN (écrite par le client), plus l'heure
--    d'insertion. Comparer `created_at > now() - 90 s` revient à confronter une
--    heure de scan à une horloge murale : les courses drainées d'un carnet
--    (horodatage ancien) échappent au test, et le test lui-même a perdu son sens.
--
-- La clé exacte existe déjà : `scan_ts`, posé par le process de scan et porté
-- par tous les chemins (bouton Action, bulle, écriture native directe, rejeu du
-- carnet). Deux enregistrements du MÊME scan la partagent ; deux offres
-- distinctes ne peuvent pas l'avoir en commun — elle porte les millisecondes.
--
-- Pourquoi garder un trigger alors que `rides_user_scan_ts_uq` refuse déjà les
-- doublons : l'ordre des gardes. Le trigger passe AVANT `check_scan_quota`
-- (préfixe « aa_ », les triggers BEFORE se déclenchent par ordre alphabétique).
-- Laisser l'index seul décider ferait tourner le contrôle de quota sur un rejeu
-- de course déjà en base : un chauffeur à sa limite recevrait une erreur
-- `daily_scan_quota_exceeded` pour une course pourtant enregistrée, que l'app
-- traite comme un refus définitif et signale à tort comme non enregistrée.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.skip_duplicate_ride()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Chemin normal : identité exacte du scan. Rejouer un scan (carnet natif,
  -- reprise de l'ancienne file, écriture native puis remontée par l'app) est
  -- ainsi idempotent sans jamais confondre deux offres différentes.
  if new.scan_ts is not null then
    if exists (
      select 1
        from public.rides
       where user_id = new.user_id
         and scan_ts = new.scan_ts
    ) then
      raise notice 'Rejeu du scan % ignoré pour %', new.scan_ts, new.user_id;
      return null;
    end if;
    return new;
  end if;

  -- Repli pour les payloads SANS `scan_ts` : uniquement les courses héritées de
  -- l'ancienne file AsyncStorage, écrites par des builds antérieurs au 16 août.
  -- Pour elles `created_at` vaut bien l'heure d'insertion (le client ne
  -- l'écrase que lorsqu'il connaît `scan_ts`), donc la fenêtre garde son sens.
  -- À supprimer une fois le parc migré.
  if exists (
    select 1
      from public.rides
     where user_id        = new.user_id
       and platform       = new.platform
       and fare_estimated = new.fare_estimated
       and distance_km    = new.distance_km
       and scan_ts is null
       and created_at     > now() - interval '90 seconds'
  ) then
    raise notice 'Doublon hérité (sans scan_ts) ignoré pour %', new.user_id;
    return null;
  end if;

  return new;
end;
$$;

-- Le trigger lui-même ne change pas (nom, moment, ordre) — on ne remplace que
-- le corps de la fonction. Recréé ici pour que la migration soit rejouable sur
-- une base où il aurait été supprimé.
drop trigger if exists aa_skip_duplicate_ride on public.rides;
create trigger aa_skip_duplicate_ride
  before insert on public.rides
  for each row execute function public.skip_duplicate_ride();

-- Index : la recherche par (user_id, scan_ts) est servie par
-- `rides_user_scan_ts_uq` (20260817). Le repli sans scan_ts reste couvert par
-- `idx_rides_user_created`. Rien à créer.

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Deux offres distinctes aux mêmes chiffres passent toutes les deux :
--      insert into rides (user_id, platform, status, fare_estimated, distance_km,
--                         duration_min, hourly_rate, km_rate, scan_ts)
--      values (auth.uid(), 'UBER', 'PENDING', 12.50, 5.2, 15, 50, 2.4, 1755600000.123),
--             (auth.uid(), 'UBER', 'PENDING', 12.50, 5.2, 15, 50, 2.4, 1755600042.456);
--    → 2 lignes. Avant cette migration, la seconde était avalée.
--
-- 2. Le rejeu du même scan reste idempotent :
--      insert into rides (…, scan_ts) values (…, 1755600000.123);
--    → 0 ligne insérée, aucune erreur.
--
-- 3. Le quota n'est pas consommé par un rejeu — sur un compte free à 3 scans
--    déjà atteints, rejouer un scan déjà en base ne doit PAS lever
--    `daily_scan_quota_exceeded`.
--
-- 4. Nettoyage des jeux d'essai :
--      delete from rides where scan_ts in (1755600000.123, 1755600042.456);
