-- ═══════════════════════════════════════════════════════════════════════════
-- scan_failures : `gemini_ko` devient `offer_unreadable`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Gemini n'est plus appelé par le raccourci ni par la bulle : le motif ne
-- désigne plus qu'un écran d'offre que le parser n'a pas su lire. Le nom
-- trompait à la lecture des agrégats.
--
-- Les builds déjà en circulation (≤ 1.0.5) envoient encore `gemini_ko` : le
-- RPC le traduit au lieu de le laisser tomber sous 'other'. L'historique est
-- renommé, pour qu'un même motif ne s'affiche pas sous deux noms.
--
-- Le code support 0xC0FE0962 ne change pas (contrat public).
--
-- Seuls la traduction et la liste changent ; le reste de la fonction est
-- recopié à l'identique de 20261012.

update public.scan_failures set reason = 'offer_unreadable' where reason = 'gemini_ko';

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
  -- Ancien nom, encore envoyé par les builds ≤ 1.0.5.
  if v_reason = 'gemini_ko' then
    v_reason := 'offer_unreadable';
  end if;

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
    'offer_unreadable',   -- écran d'offre que le parser n'a pas su lire
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
