-- ═══════════════════════════════════════════════════════════════════════════
-- scan_failures : trois motifs de plus, pour l'itinéraire
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI MANQUAIT. Quand TomTom ne rendait pas d'itinéraire, l'app se rabattait
-- sur la distance et la durée LUES SUR L'ÉCRAN — celles de la plateforme — et
-- les affichait avec le même verdict coloré qu'une vraie mesure. Deux chauffeurs
-- côte à côte sur la même course ont vu 100 €/h et 38 €/h ; le second avait
-- raison. L'app montre désormais une erreur plutôt qu'un chiffre qu'elle n'a pas
-- mesuré, et cet échec doit se compter comme les autres.
--
-- Le vocabulaire est FERMÉ côté RPC : un motif hors liste n'est pas rejeté, il
-- devient 'other' et sa valeur brute part dans `detail`. Sans cette migration,
-- les trois nouveaux motifs seraient donc arrivés en base sous 'other' — pas
-- perdus, mais noyés, et le partage entre « le réseau n'a pas répondu » et
-- « l'adresse n'était pas exploitable » aurait été illisible. C'est précisément
-- ce partage qui dira s'il faut un retry ou un meilleur géocodage.
--
-- Seul le `if` change ; le reste de la fonction est recopié à l'identique
-- (`create or replace` remplace le corps entier, il n'y a pas de demi-mesure).

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
    'route_no_key'        -- installation sans clé TomTom : rien de mesurable
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Rattrapage : les échecs d'itinéraire déjà arrivés sous 'other'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Si un build est parti avant cette migration, ses échecs d'itinéraire sont en
-- base sous 'other' avec le vrai motif en tête de `detail` — c'est exactement ce
-- que fait la branche ci-dessus. On les remet à leur place plutôt que de les
-- laisser fausser le premier comptage. Sans effet si rien n'est concerné.

update public.scan_failures
set reason = split_part(detail, ' ', 1),
    detail = nullif(trim(substr(detail, length(split_part(detail, ' ', 1)) + 2)), '')
where reason = 'other'
  and split_part(detail, ' ', 1) in ('route_unreachable', 'route_unusable', 'route_no_key');
