-- ═══════════════════════════════════════════════════════════════════════════
-- rides.scan_ts — clé de corrélation course ↔ décision « Prise / Refusée »
-- ═══════════════════════════════════════════════════════════════════════════
-- Les boutons ✅/❌ de la Live Activity, des notifications et des commandes
-- vocales s'exécutent HORS de l'app (AppIntent, autre process, app parfois
-- tuée). Ils ne connaissent pas l'id de la course — seulement l'horodatage du
-- scan (`scanTs`, epoch secondes) déposé dans l'App Group. Le client recollait
-- les deux en cherchant la course PENDING dont `created_at` tombait à moins de
-- 180 s du scan.
--
-- Or `created_at` est l'heure d'INSERTION, pas celle du scan. Une course scannée
-- app fermée n'est insérée qu'à la réouverture de l'app — souvent des minutes,
-- parfois des heures plus tard. La fenêtre de 180 s était alors dépassée : la
-- décision partait dans un tampon en mémoire, et ce tampon mourait avec le
-- process JS. Le chauffeur tapait « Prise », rien ne se passait, et rien n'en
-- gardait la trace.
--
-- `scan_ts` porte la clé exacte que les deux côtés possèdent déjà.
-- `double precision` et non `timestamptz` : c'est la valeur brute échangée avec
-- le natif (epoch secondes, Double), donc l'égalité est exacte, sans conversion
-- ni arrondi intermédiaire.
--
-- Les lignes existantes restent à NULL. Le repli temporel des 180 s est conservé
-- côté client POUR ELLES uniquement — il ne sert plus que l'historique.
--
-- `rides` ne figure dans aucune migration (schéma d'origine créé via le
-- dashboard) : bloc guardé par `to_regclass`, même discipline que
-- 20260811_rides_fuel_columns.sql, pour qu'un replay à blanc n'échoue pas ici.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.rides') is null then return; end if;

  alter table public.rides add column if not exists scan_ts double precision;

  -- Seul accès prévu : « la course de CE scan, pour CET utilisateur ». Index
  -- partiel — les lignes antérieures à cette migration n'ont pas la clé et
  -- n'ont aucune raison d'alourdir l'index.
  create index if not exists rides_user_scan_ts_idx
    on public.rides (user_id, scan_ts)
    where scan_ts is not null;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'rides'
--      and column_name = 'scan_ts';
--   → une ligne, double precision.
--
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'rides'
--      and indexname = 'rides_user_scan_ts_idx';
--   → une ligne.
