-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 20260826_scan_debug_opt_out.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ CE FICHIER N'EST PAS UNE MIGRATION. Il vit hors de `supabase/migrations/`
-- exprès : posé là-bas, il serait rejoué au prochain `db push`. À exécuter à la
-- main, une fois, dans l'éditeur SQL.
--
-- ⚠️ ET IL ROUVRE UNE PROMESSE NON TENUE. `PRIVACY_POLICY.md` §2.6 annonce que
-- l'opposition désactive la capture pour le compte concerné. Sans le drapeau,
-- ce n'est plus vrai — une opposition reçue par e-mail ne vaudrait à nouveau
-- que jusqu'au scan suivant. À ne jouer que si la politique change en même
-- temps.
--
-- La COLONNE n'est pas supprimée : elle ne gêne personne, et la garder permet
-- de rejouer la migration sans repasser par un ALTER TABLE. Seule la garde
-- dans la RPC est retirée — c'est elle qui porte le comportement.

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
  p_app_version        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocks jsonb := p_blocks;
begin
  if v_blocks is not null and length(v_blocks::text) > 100000 then
    v_blocks := null;
  end if;

  insert into public.scan_debug (
    user_id, platform, screen_height, blocks,
    native_pickup, native_destination, native_fare, native_distance_km,
    native_duration_min, pickup_missing, dest_missing,
    gemini_used, gemini_pickup, gemini_destination, app_version
  ) values (
    auth.uid(),
    nullif(left(coalesce(p_platform, ''), 16), ''),
    p_screen_height,
    v_blocks,
    p_native_pickup, p_native_destination, p_native_fare, p_native_distance_km,
    p_native_duration_min, coalesce(p_pickup_missing, false), coalesce(p_dest_missing, false),
    coalesce(p_gemini_used, false), p_gemini_pickup, p_gemini_destination,
    nullif(left(coalesce(p_app_version, ''), 32), '')
  );
end;
$$;
