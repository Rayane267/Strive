-- ═══════════════════════════════════════════════════════════════════════════
-- rides.scan_ts — clé d'IDEMPOTENCE (et plus seulement de corrélation)
-- ═══════════════════════════════════════════════════════════════════════════
-- Depuis que le natif enregistre la course DÈS le scan (Share Extension et
-- raccourci écrivent directement dans `rides`), deux chemins peuvent tenter la
-- même insertion :
--   1. le process de scan, immédiatement ;
--   2. l'app principale, en vidant la file `pendingScanResults` de l'App Group
--      si l'écriture directe a échoué (hors réseau, JWT expiré, process tué).
--
-- Le trigger `aa_skip_duplicate_ride` ne couvre qu'une fenêtre de 90 s : une
-- course scannée app fermée et rejouée des heures plus tard passait à travers.
-- L'index unique ci-dessous rend le doublon IMPOSSIBLE quelle que soit la
-- latence : les deux chemins portent le même `scan_ts` (epoch du scan, écrit
-- une seule fois par le natif).
--
-- Remplace l'index non-unique de 20260816_rides_scan_ts.sql (mêmes colonnes,
-- même prédicat) : un seul index sert les deux usages, lecture et unicité.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.rides') is null then return; end if;

  -- Dédoublonnage préalable : l'index unique refuserait de se créer s'il reste
  -- des paires (user_id, scan_ts) en double héritées de l'ancien flux. On garde
  -- la plus ancienne (celle qui porte les décisions Prise/Refusée déjà tapées).
  delete from public.rides r
   using public.rides keep
   where r.scan_ts is not null
     and keep.scan_ts = r.scan_ts
     and keep.user_id = r.user_id
     and (keep.created_at, keep.id) < (r.created_at, r.id);

  drop index if exists public.rides_user_scan_ts_idx;

  create unique index if not exists rides_user_scan_ts_uq
    on public.rides (user_id, scan_ts)
    where scan_ts is not null;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'rides'
--      and indexname = 'rides_user_scan_ts_uq';
--   → une ligne, "CREATE UNIQUE INDEX … WHERE (scan_ts IS NOT NULL)".
--
--   select user_id, scan_ts, count(*) from public.rides
--    where scan_ts is not null group by 1, 2 having count(*) > 1;
--   → zéro ligne.
