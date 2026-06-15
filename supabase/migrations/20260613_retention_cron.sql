-- ═══════════════════════════════════════════════════════════════════════════
-- Rétention automatisée (pg_cron) — purge scan_debug (30 j)
-- ═══════════════════════════════════════════════════════════════════════════
-- Les courses (adresses incluses) sont conservées tant que le compte existe
-- (finalité : historique & stats du chauffeur) — voir politique de
-- confidentialité. Seules les captures de DIAGNOSTIC bêta (scan_debug), qui
-- peuvent contenir des adresses lues à l'OCR, sont purgées à 30 jours.
--
-- pg_cron doit être activé sur le projet (Dashboard → Database → Extensions).
-- Job idempotent (unschedule puis schedule).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

-- scan_debug (30 j) — purge_scan_debug() est défini dans 20260613_scan_debug.sql.
do $$
begin
  perform cron.unschedule('purge-scan-debug');
exception when others then
  null; -- le job n'existait pas encore
end $$;
select cron.schedule(
  'purge-scan-debug',
  '45 3 * * *',
  $$ select public.purge_scan_debug() $$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs planifiés :   select jobname, schedule, command from cron.job;
-- Historique :       select * from cron.job_run_details order by start_time desc limit 10;
