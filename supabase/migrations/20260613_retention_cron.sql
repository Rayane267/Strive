-- ═══════════════════════════════════════════════════════════════════════════
-- Rétention automatisée (pg_cron) — purge des adresses > 12 mois + scan_debug
-- ═══════════════════════════════════════════════════════════════════════════
-- Rend effectives les durées annoncées dans la politique de confidentialité :
--   1. Les ADRESSES (pickup/destination) des courses de plus de 12 mois sont
--      effacées — on garde la course et ses métriques (tarif, distance, durée)
--      pour l'historique/stats, mais on retire la donnée personnelle.
--   2. Les captures de diagnostic scan_debug de plus de 30 jours sont supprimées.
--
-- pg_cron doit être activé sur le projet (Dashboard → Database → Extensions,
-- ou la commande ci-dessous). Les jobs sont planifiés de façon idempotente
-- (unschedule puis schedule) → ré-exécutable sans créer de doublon.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;


-- ─── 1. Purge des adresses des courses > 12 mois ───
create or replace function public.purge_old_ride_addresses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.rides
    set pickup_address = null,
        destination_address = null
    where created_at < now() - interval '12 months'
      and (pickup_address is not null or destination_address is not null);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.purge_old_ride_addresses() from public;


-- ─── 2. Planification des purges ───
-- Adresses : tous les jours à 03:30 (UTC).
do $$
begin
  perform cron.unschedule('purge-ride-addresses');
exception when others then
  null; -- le job n'existait pas encore
end $$;
select cron.schedule(
  'purge-ride-addresses',
  '30 3 * * *',
  $$ select public.purge_old_ride_addresses() $$
);

-- scan_debug (30 j) : tous les jours à 03:45 (UTC).
-- purge_scan_debug() est défini dans 20260613_scan_debug.sql.
do $$
begin
  perform cron.unschedule('purge-scan-debug');
exception when others then
  null;
end $$;
select cron.schedule(
  'purge-scan-debug',
  '45 3 * * *',
  $$ select public.purge_scan_debug() $$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs planifiés :
--   select jobname, schedule, command from cron.job order by jobname;
-- Test manuel de la purge adresses (renvoie le nb de lignes nettoyées) :
--   select public.purge_old_ride_addresses();
-- Historique d'exécution :
--   select * from cron.job_run_details order by start_time desc limit 10;
