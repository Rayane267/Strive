-- ═══════════════════════════════════════════════════════════════════════════
-- scan_debug : chaque capture dit de quel échec elle est la trace
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une capture prise sur un échec n'était reliée à son motif que par l'heure
-- d'insertion. Or la file native se vide d'un coup au retour de l'app : trois
-- échecs et une capture tombaient dans la même seconde, et il fallait deviner
-- lequel l'avait produite. Le motif et son détail (« no_fare platform=BOLT »,
-- « geocode dest=none ») sont désormais écrits sur la capture elle-même.
--
-- NULL = capture d'un scan réussi (adresse manquante ou incohérente), ou
-- capture antérieure à cette migration.
--
-- La fonction change de signature (deux paramètres de plus, avec défaut) : on
-- supprime l'ancienne, sinon les deux surcharges coexisteraient et l'appel des
-- builds déjà publiés, qui n'envoient pas ces paramètres, deviendrait ambigu.
-- Le corps est recopié de 20260826_scan_debug_opt_out.sql, opposition comprise.

alter table public.scan_debug
  add column if not exists failure_reason text,
  add column if not exists failure_detail text;

drop function if exists public.log_scan_debug(
  text, int, jsonb, text, text, numeric, numeric, int, boolean, boolean, boolean, text, text, text
);

create or replace function public.log_scan_debug(
  p_platform           text,
  p_screen_height      int,
  p_blocks             jsonb,
  p_native_pickup      text,
  p_native_destination text,
  p_native_fare        numeric,
  p_native_distance_km numeric,
  p_native_duration_min int,
  p_pickup_missing     boolean,
  p_dest_missing       boolean,
  p_gemini_used        boolean,
  p_gemini_pickup      text,
  p_gemini_destination text,
  p_app_version        text,
  p_failure_reason     text default null,
  p_failure_detail     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocks jsonb := p_blocks;
begin
  -- Opposition : on ne stocke rien, et on ne lève pas.
  if exists (
    select 1 from public.preferences
     where id = auth.uid() and scan_debug_opt_out
  ) then
    return;
  end if;

  -- Garde-fou taille : au-delà de 100 Ko, on garde la ligne sans les blocs.
  if v_blocks is not null and length(v_blocks::text) > 100000 then
    v_blocks := null;
  end if;

  insert into public.scan_debug (
    user_id, platform, screen_height, blocks,
    native_pickup, native_destination, native_fare, native_distance_km,
    native_duration_min, pickup_missing, dest_missing,
    gemini_used, gemini_pickup, gemini_destination, app_version,
    failure_reason, failure_detail
  ) values (
    auth.uid(),
    nullif(left(coalesce(p_platform, ''), 16), ''),
    p_screen_height,
    v_blocks,
    p_native_pickup, p_native_destination, p_native_fare, p_native_distance_km,
    p_native_duration_min, coalesce(p_pickup_missing, false), coalesce(p_dest_missing, false),
    coalesce(p_gemini_used, false), p_gemini_pickup, p_gemini_destination,
    nullif(left(coalesce(p_app_version, ''), 32), ''),
    nullif(left(lower(coalesce(p_failure_reason, '')), 32), ''),
    nullif(left(coalesce(p_failure_detail, ''), 300), '')
  );
end;
$$;

revoke execute on function public.log_scan_debug(
  text, int, jsonb, text, text, numeric, numeric, int, boolean, boolean, boolean, text, text, text, text, text
) from public;
grant execute on function public.log_scan_debug(
  text, int, jsonb, text, text, numeric, numeric, int, boolean, boolean, boolean, text, text, text, text, text
) to authenticated;
