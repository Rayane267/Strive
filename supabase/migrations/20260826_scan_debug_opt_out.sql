-- ═══════════════════════════════════════════════════════════════════════════
-- Le droit d'opposition à la capture de diagnostic devient exécutable
-- ═══════════════════════════════════════════════════════════════════════════
-- CE QU'ON A PROMIS. `PRIVACY_POLICY.md` §2.6, sur la capture de diagnostic :
-- « Vous pouvez vous y opposer à tout moment en écrivant à
--   contact@striveapp.fr : la capture est alors désactivée pour votre compte
--   et les captures existantes supprimées. »
--
-- CE QU'ON SAVAIT FAIRE. Supprimer les lignes. Rien d'autre : aucun drapeau,
-- nulle part. Une opposition ne valait donc que jusqu'au scan suivant, et la
-- promesse était intenable — le RGPD prévoit que l'opposition à un traitement
-- fondé sur l'intérêt légitime (art. 21) l'arrête, pas qu'elle nettoie derrière
-- lui en attendant qu'il recommence.
--
-- OÙ VIT LE DRAPEAU. Dans `preferences`, et pas dans `profiles` : c'est une
-- préférence du chauffeur, pas un attribut de compte. Elle est donc modifiable
-- par son propriétaire sous les policies existantes — ce qui laisse la porte
-- ouverte à un interrupteur dans l'app, sans nouvelle migration.
--
-- CE QUI FAIT AUTORITÉ. Le contrôle est dans la RPC, pas dans le client. Une
-- garde côté app se contourne en rejouant l'appel ; et surtout, un bundle JS
-- antérieur continuerait d'écrire sans rien savoir du drapeau. Le client la
-- double quand même, pour s'épargner un aller-retour réseau.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.preferences
  add column if not exists scan_debug_opt_out boolean not null default false;

comment on column public.preferences.scan_debug_opt_out is
  'Opposition à la capture de diagnostic (PRIVACY_POLICY §2.6). true = aucune '
  'capture n''est enregistrée pour ce compte. Lu par log_scan_debug().';

-- ═══════════════════════════════════════════════════════════════════════════
-- log_scan_debug : sortie immédiate si le chauffeur s'est opposé
-- ═══════════════════════════════════════════════════════════════════════════
-- Recopie de 20260613_scan_debug.sql, quatre lignes en plus au début. Le reste
-- est inchangé, garde-fou de taille compris.
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
  -- Opposition : on ne stocke rien, et on ne lève pas. L'appelant est en
  -- fire-and-forget sur le chemin d'un scan — une erreur y serait pire que le
  -- silence, et il n'a rien à faire de la réponse.
  if exists (
    select 1 from public.preferences
     where id = auth.uid() and scan_debug_opt_out
  ) then
    return;
  end if;

  -- Garde-fou taille : un dump de blocs dépasse rarement ~10 Ko. Au-delà de
  -- 100 Ko on considère que c'est anormal (abus / écran géant) → on ne stocke
  -- pas les blocs mais on garde la ligne (contexte exploitable).
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

-- ═══════════════════════════════════════════════════════════════════════════
-- TRAITER UNE OPPOSITION REÇUE PAR E-MAIL
-- ═══════════════════════════════════════════════════════════════════════════
-- En service_role, les deux gestes que la politique annonce — on coupe, puis on
-- efface l'existant :
--
--   update public.preferences set scan_debug_opt_out = true
--    where id = (select id from auth.users where email = '<adresse>');
--
--   delete from public.scan_debug
--    where user_id = (select id from auth.users where email = '<adresse>');
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. En JWT `authenticated`, drapeau à false : `select log_scan_debug(…)` doit
--    créer une ligne dans `scan_debug`.
-- 2. Le drapeau passé à true, le MÊME appel ne doit plus rien créer, et ne doit
--    pas lever.
-- 3. Un compte sans ligne dans `preferences` n'est pas opposé : le `exists`
--    rend false, la capture a lieu. C'est le comportement d'avant.
