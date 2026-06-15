-- ═══════════════════════════════════════════════════════════════════════════
-- scan_debug — capture diagnostique des scans qui RATENT une adresse
-- ═══════════════════════════════════════════════════════════════════════════
-- But : quand le parser natif ne trouve pas pickup et/ou destination, on
-- enregistre les blocs OCR bruts (texte + coordonnées) pour :
--   1. reproduire le cas en FIXTURE et corriger le parser à la source,
--   2. constituer un EMBRYON DE DATASET LABELLISÉ pour de futurs travaux ML.
--
-- ⚠️ Contient des DONNÉES PERSONNELLES (adresses dans les blocs). Donc :
--   - RLS owner-only (un user ne voit QUE ses propres captures),
--   - écriture via RPC security-definer uniquement (aucun insert client direct),
--   - rétention courte (purge 30 j, voir purge_scan_debug),
--   - réservé à la BÊTA avec testeurs consentants (mention privacy policy).
--
-- Design dataset : on stocke 3 niveaux de vérité côte à côte —
--   native_*  : ce que le parser heuristique a sorti (et ce qui manque),
--   gemini_*  : ce que le fallback Gemini a récupéré (label approché),
--   user_*    : correction utilisateur (label fort — colonnes prêtes, à câbler
--               quand l'écran d'édition de course enverra les corrections).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.scan_debug (
  id                  bigserial primary key,
  user_id             uuid references auth.users(id) on delete set null,
  platform            text,
  screen_height       int,
  -- Blocs OCR bruts : [{ "text": "...", "x": int, "y": int, "w": int, "h": int }]
  -- (mêmes coordonnées que celles vues par le parser → rejouables en fixture).
  blocks              jsonb,

  -- Niveau 1 — sortie du parser natif (heuristique)
  native_pickup       text,
  native_destination  text,
  native_fare         numeric,
  native_distance_km  numeric,
  native_duration_min int,
  pickup_missing      boolean not null default false,
  dest_missing        boolean not null default false,

  -- Niveau 2 — récupération Gemini (label approché)
  gemini_used         boolean not null default false,
  gemini_pickup       text,
  gemini_destination  text,

  -- Niveau 3 — correction utilisateur (label fort — à câbler plus tard)
  user_pickup         text,
  user_destination    text,

  app_version         text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_scan_debug_created
  on public.scan_debug (created_at desc);
-- Pour requêter rapidement les cas "destination ratée" lors du diagnostic.
create index if not exists idx_scan_debug_dest_missing
  on public.scan_debug (created_at desc) where dest_missing;

alter table public.scan_debug enable row level security;

-- Lecture : un user voit ses propres captures (transparence RGPD).
drop policy if exists "scan_debug_select_own" on public.scan_debug;
create policy "scan_debug_select_own"
  on public.scan_debug for select
  to authenticated
  using (auth.uid() = user_id);

-- Écriture : via RPC security-definer uniquement (aucune policy INSERT pour
-- authenticated → insert direct bloqué).


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC log_scan_debug — appelée par le client quand une adresse manque
-- ═══════════════════════════════════════════════════════════════════════════
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

revoke execute on function public.log_scan_debug(
  text, int, jsonb, text, text, numeric, numeric, int, boolean, boolean, boolean, text, text, text
) from public;
grant execute on function public.log_scan_debug(
  text, int, jsonb, text, text, numeric, numeric, int, boolean, boolean, boolean, text, text, text
) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Rétention — purge des captures de plus de 30 jours
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.purge_scan_debug()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.scan_debug where created_at < now() - interval '30 days';
$$;

-- Planifier si pg_cron est activé (Dashboard → Database → Extensions) :
--   select cron.schedule('purge-scan-debug', '0 3 * * *',
--     $$ select public.purge_scan_debug() $$);
-- Sinon, appeler manuellement de temps en temps : select public.purge_scan_debug();


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS / EXPLOITATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Cas destination ratée à transformer en fixtures :
--   select id, platform, screen_height, native_pickup, native_destination,
--          gemini_destination, blocks
--     from scan_debug
--     where dest_missing
--     order by created_at desc;
