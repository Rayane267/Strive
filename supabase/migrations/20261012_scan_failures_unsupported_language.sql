-- ═══════════════════════════════════════════════════════════════════════════
-- scan_failures : un motif de plus, la langue non prise en charge
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une offre affichée dans une langue que Strive ne lit pas (roumain, polonais,
-- turc, écritures non latines…) est désormais REFUSÉE avant le parse, avec une
-- consigne : passer l'app VTC en anglais. Ses repères (« Course de »,
-- « à X min ») n'y existent pas ; le parser pouvait inverser la course et
-- l'approche sans échouer, et rendre un verdict faux que rien ne signalait.
--
-- `detail` porte la langue du téléphone (« ro-FR ») : c'est elle qui dira
-- quelles langues reviennent assez pour être apprises.
--
-- Sans cette migration le motif arriverait sous 'other'. Seul le `if` change ;
-- le reste de la fonction est recopié à l'identique de 20260918.

create or replace function public.log_scan_failure(
  p_reason      text,
  p_os          text,
  p_surface     text,
  p_platform    text,
  p_detail      text,
  p_app_version text,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := lower(coalesce(p_reason, ''));
  v_detail text := p_detail;
begin
  -- Vocabulaire fermé : garde les agrégats lisibles. Un motif hors liste n'est
  -- jamais rejeté (on perdrait le signal) — il devient 'other' et sa valeur
  -- brute part dans `detail`.
  if v_reason not in (
    'scanner_off',        -- toggle scanner coupé
    'session_off',        -- pas de session en cours
    'quota_reached',      -- quota journalier atteint
    'invalid_image',      -- capture illisible
    'throttled',          -- verrou anti double-tap
    'ocr_empty',          -- OCR n'a rien lu
    'not_a_ride',         -- texte lu, mais aucun signal d'offre VTC
    'gemini_ko',          -- fallback Gemini indisponible ou sans réponse
    'no_addresses',       -- offre lue mais aucune adresse exploitable
    'la_start_failed',    -- Live Activity impossible à démarrer (arrière-plan)
    'expired',            -- activité de fond reprise par le système
    'timeout',            -- pipeline sans réponse dans le délai imparti
    'route_unreachable',  -- TomTom n'a pas répondu (réseau, timeout, HTTP)
    'route_unusable',     -- TomTom a répondu : adresse ou trajet inexploitable
    'route_no_key',       -- installation sans clé TomTom : rien de mesurable
    'unsupported_language' -- offre dans une langue que l'app ne lit pas
  ) then
    v_detail := left(coalesce(v_reason, '') || ' ' || coalesce(v_detail, ''), 300);
    v_reason := 'other';
  end if;

  insert into public.scan_failures (
    user_id, reason, os, surface, platform, detail, app_version, occurred_at
  ) values (
    auth.uid(),
    v_reason,
    nullif(left(lower(coalesce(p_os, '')), 16), ''),
    nullif(left(lower(coalesce(p_surface, '')), 24), ''),
    nullif(left(coalesce(p_platform, ''), 16), ''),
    nullif(left(coalesce(v_detail, ''), 300), ''),
    nullif(left(coalesce(p_app_version, ''), 32), ''),
    coalesce(p_occurred_at, now())
  );
end;
$$;

revoke execute on function public.log_scan_failure(
  text, text, text, text, text, text, timestamptz
) from public;
grant execute on function public.log_scan_failure(
  text, text, text, text, text, text, timestamptz
) to authenticated;
