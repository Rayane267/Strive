-- ═══════════════════════════════════════════════════════════════════════════
-- Fix RGPD : delete_account() — cascade COMPLÈTE des données personnelles
-- ═══════════════════════════════════════════════════════════════════════════
-- Problème (audit Strive) : la version initiale (20260425_delete_account_rpc)
-- ne supprimait que rides / preferences / profiles avant auth.users. Or :
--   - cars / online_sessions : si leur FK n'a pas ON DELETE CASCADE, le
--     `delete from auth.users` lève une violation FK → suppression IMPOSSIBLE.
--   - scan_debug : FK en ON DELETE SET NULL → les BLOCS OCR (qui contiennent
--     des ADRESSES = données personnelles) survivent à la suppression du compte
--     jusqu'à la purge 30 j. Non conforme au « droit à l'effacement ».
--
-- Correctif : on supprime explicitement toutes les tables porteuses de données
-- personnelles AVANT auth.users. Idempotent : peut être ré-exécuté. Les tables
-- d'audit/anti-abus (audit_log, device_signups) restent en SET NULL — intérêt
-- légitime (fraude/facturation), elles ne contiennent pas d'adresses.
--
-- to_regclass(...) IS NOT NULL : ignore proprement une table absente plutôt
-- que de faire échouer toute la suppression.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Données personnelles à effacer réellement (adresses, courses, véhicules,
  --    sessions, captures de diagnostic, événements analytics).
  if to_regclass('public.scan_debug')      is not null then delete from public.scan_debug      where user_id = uid; end if;
  if to_regclass('public.scan_events')     is not null then delete from public.scan_events     where user_id = uid; end if;
  if to_regclass('public.online_sessions') is not null then delete from public.online_sessions where user_id = uid; end if;
  if to_regclass('public.cars')            is not null then delete from public.cars            where user_id = uid; end if;
  delete from public.rides       where user_id = uid;
  delete from public.preferences where id = uid;
  delete from public.profiles    where id = uid;

  -- 2. Compte auth (les FK restantes en SET NULL — audit_log, device_signups —
  --    se détachent automatiquement ; aucune ne doit bloquer ce delete).
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_account() to authenticated;
