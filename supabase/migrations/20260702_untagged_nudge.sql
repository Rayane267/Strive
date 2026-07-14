-- ═══════════════════════════════════════════════════════════════════════════
-- Nudge push "Tague tes courses" — 5+ courses PENDING non taguées
-- ═══════════════════════════════════════════════════════════════════════════
-- Objectif : quand un chauffeur laisse ≥ 5 courses scannées sans les accepter
-- ni les refuser, on lui envoie un push (FCM) l'invitant à les taguer pour des
-- stats précises. Piloté côté serveur (le JS ne tourne pas app fermée).
--
-- Pièces :
--   1. profiles.last_untagged_nudge_at  → cooldown anti-spam
--   2. claim_untagged_nudges(...)       → sélectionne ET marque en une passe
--      (atomique : deux exécutions concurrentes ne double-notifient pas)
--   3. cron (pg_cron + pg_net)          → appelle l'edge function notify-untagged
-- ═══════════════════════════════════════════════════════════════════════════

-- Colonnes push (défensif : l'app les écrit déjà, mais aucune migration ne les
-- déclarait — on garantit leur présence).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fcm_token text,
  ADD COLUMN IF NOT EXISTS device_platform text,
  ADD COLUMN IF NOT EXISTS last_untagged_nudge_at timestamptz;

-- ── RPC : réclame les chauffeurs à notifier ────────────────────────────────
-- Retourne les candidats (≥ min_pending courses PENDING, token présent, hors
-- cooldown) et pose last_untagged_nudge_at = now() sur ces mêmes lignes dans la
-- même requête → idempotent même en cas d'appels concurrents.
CREATE OR REPLACE FUNCTION public.claim_untagged_nudges(
  min_pending int DEFAULT 5,
  cooldown interval DEFAULT interval '6 hours'
)
RETURNS TABLE (user_id uuid, fcm_token text, preferred_lang text, pending_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT p.id, p.fcm_token AS token, p.preferred_lang AS lang, count(r.id) AS cnt
    FROM public.profiles p
    JOIN public.rides r
      ON r.user_id = p.id AND r.status = 'PENDING'
    WHERE p.fcm_token IS NOT NULL
      AND (p.last_untagged_nudge_at IS NULL
           OR p.last_untagged_nudge_at < now() - cooldown)
    GROUP BY p.id
    HAVING count(r.id) >= min_pending
  ),
  marked AS (
    UPDATE public.profiles p
       SET last_untagged_nudge_at = now()
      FROM candidates c
     WHERE p.id = c.id
    RETURNING p.id
  )
  SELECT c.id, c.token, c.lang, c.cnt FROM candidates c;
END;
$$;

-- Réservé au service_role (appelé par l'edge function). Pas d'accès client.
REVOKE ALL ON FUNCTION public.claim_untagged_nudges(int, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_untagged_nudges(int, interval) TO service_role;

-- ── Planification (pg_cron + pg_net) ───────────────────────────────────────
-- L'edge function fait le vrai boulot (mint OAuth Google + envoi FCM). Le cron
-- ne fait que la déclencher toutes les 30 min. URL + clé service_role lus depuis
-- Vault → aucun secret en clair dans le dépôt.
--
--   PRÉREQUIS (à faire une fois dans le Dashboard Supabase) :
--     • Database › Extensions : activer pg_cron ET pg_net
--     • Vault : ajouter les secrets
--         - project_url       = https://<ref>.supabase.co
--         - service_role_key  = <clé service_role>
--     • Edge Function secrets : FCM_SERVICE_ACCOUNT_JSON = <JSON compte de service>
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-untagged') THEN
      PERFORM cron.unschedule('notify-untagged');
    END IF;

    PERFORM cron.schedule(
      'notify-untagged',
      '*/30 * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
               || '/functions/v1/notify-untagged',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Vérifs :  SELECT jobname, schedule FROM cron.job;
--           SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
-- ═══════════════════════════════════════════════════════════════════════════
