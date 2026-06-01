-- ═══════════════════════════════════════════════════════════════════════════
-- Adresses de départ/destination par course (carnet de bord chauffeur)
-- ═══════════════════════════════════════════════════════════════════════════
-- RGPD : ces adresses sont des données personnelles (du passager surtout).
-- Cadre = carnet de bord du chauffeur (il consigne SES courses). Rétention
-- limitée à 12 mois : passé ce délai, les adresses sont effacées, le reste de
-- la course (tarif, distance, durée) est conservé pour les analytics.
-- ═══════════════════════════════════════════════════════════════════════════

-- La table `rides` peut ne pas exister sur une base fraîche (les tables de base
-- ont historiquement été créées via Supabase Studio, pas par migration). On la
-- crée si besoin — NO-OP si elle existe déjà (schéma existant non modifié).
CREATE TABLE IF NOT EXISTS public.rides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform        text NOT NULL DEFAULT 'UBER',
  status          text NOT NULL DEFAULT 'PENDING',
  fare_estimated  numeric NOT NULL DEFAULT 0,
  fare_final      numeric,
  distance_km     numeric NOT NULL DEFAULT 0,
  duration_min    integer NOT NULL DEFAULT 0,
  hourly_rate     numeric NOT NULL DEFAULT 0,
  km_rate         numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rides_user_created_idx
  ON public.rides (user_id, created_at DESC);

-- Colonnes adresses (idempotent).
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS destination_address text;

-- ─── RLS (idempotent — aligné avec 20260425_rls_policies.sql) ────────────────
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rides_select_own" ON public.rides;
CREATE POLICY "rides_select_own" ON public.rides FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "rides_insert_own" ON public.rides;
CREATE POLICY "rides_insert_own" ON public.rides FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "rides_update_own" ON public.rides;
CREATE POLICY "rides_update_own" ON public.rides FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "rides_delete_own" ON public.rides;
CREATE POLICY "rides_delete_own" ON public.rides FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Rétention 12 mois ───────────────────────────────────────────────────────
-- Efface les adresses des courses de plus de 12 mois (ligne conservée).
CREATE OR REPLACE FUNCTION public.purge_old_ride_addresses()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.rides
     SET pickup_address = NULL,
         destination_address = NULL
   WHERE created_at < now() - interval '12 months'
     AND (pickup_address IS NOT NULL OR destination_address IS NOT NULL);
$$;

-- Planification quotidienne via pg_cron (si l'extension est activée).
-- Supabase : Dashboard › Database › Extensions › activer "pg_cron".
-- Si pg_cron n'est pas dispo, la fonction reste appelable manuellement ou via
-- un scheduler externe ; rien ne casse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge_old_ride_addresses') THEN
      PERFORM cron.unschedule('purge_old_ride_addresses');
    END IF;
    PERFORM cron.schedule(
      'purge_old_ride_addresses',
      '0 3 * * *',
      'SELECT public.purge_old_ride_addresses();'
    );
  END IF;
END;
$$;
