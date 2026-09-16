-- ═══════════════════════════════════════════════════════════════════════════
-- scan_failures — trace des scans qui n'aboutissent PAS
-- ═══════════════════════════════════════════════════════════════════════════
-- Angle mort comblé : `scan_events` et `scan_debug` ne s'écrivent que sur un
-- scan qui aboutit et remonte jusqu'au JS. Tout ce qui casse avant — raccourci
-- iOS qui meurt, Live Activity impossible à démarrer en arrière-plan, Gemini
-- KO, quota, verrou anti double-tap — ne laissait AUCUNE trace. Un bug pouvait
-- donc toucher tout le parc sans qu'aucune donnée ne le montre.
--
-- ⚠️ Même régime que scan_debug, par cohérence (et parce que `detail` peut
-- porter un message d'erreur non maîtrisé) :
--   - RLS owner-only,
--   - écriture via RPC security-definer uniquement,
--   - rétention 30 j (purge_scan_failures).
--
-- `occurred_at` est distinct de `created_at` : sur iOS l'AppIntent tourne dans
-- un AUTRE PROCESS et n'a pas de session Supabase. Les échecs sont empilés dans
-- l'App Group puis envoyés au prochain passage de l'app au premier plan, ce qui
-- peut arriver bien plus tard. Sans cette colonne, l'analyse temporelle est
-- fausse.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.scan_failures (
  id           bigserial primary key,
  user_id      uuid references auth.users(id) on delete set null,

  -- Motif normalisé (cf. RPC : toute valeur inconnue tombe sur 'other' et le
  -- brut est conservé dans `detail`, pour ne jamais perdre une ligne).
  reason       text not null,
  -- 'ios' | 'android'
  os           text,
  -- Où le scan a été déclenché : 'shortcut' (AppIntent), 'share_ext', 'bubble'.
  surface      text,
  -- Plateforme VTC si elle a pu être lue avant l'échec (souvent null).
  platform     text,
  -- Complément court et borné : code d'erreur ActivityKit, motif brut, etc.
  detail       text,

  app_version  text,
  occurred_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_scan_failures_created
  on public.scan_failures (created_at desc);
-- Requête de diagnostic la plus fréquente : « quels motifs, sur quel OS ».
create index if not exists idx_scan_failures_reason
  on public.scan_failures (reason, os, created_at desc);

alter table public.scan_failures enable row level security;

-- Lecture : un user voit ses propres traces (transparence RGPD).
drop policy if exists "scan_failures_select_own" on public.scan_failures;
create policy "scan_failures_select_own"
  on public.scan_failures for select
  to authenticated
  using (auth.uid() = user_id);

-- Écriture : via RPC security-definer uniquement (pas de policy INSERT).


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC log_scan_failure
-- ═══════════════════════════════════════════════════════════════════════════
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
    'scanner_off',      -- toggle scanner coupé
    'session_off',      -- pas de session en cours
    'quota_reached',    -- quota journalier atteint
    'invalid_image',    -- capture illisible
    'throttled',        -- verrou anti double-tap
    'ocr_empty',        -- OCR n'a rien lu
    'not_a_ride',       -- texte lu, mais aucun signal d'offre VTC
    'gemini_ko',        -- fallback Gemini indisponible ou sans réponse
    'no_addresses',     -- offre lue mais aucune adresse exploitable
    'la_start_failed',  -- Live Activity impossible à démarrer (arrière-plan)
    'expired',          -- activité de fond reprise par le système
    'timeout'           -- pipeline sans réponse dans le délai imparti
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
-- Rétention — 30 jours, aligné sur scan_debug
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.purge_scan_failures()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.scan_failures where created_at < now() - interval '30 days';
$$;

-- Planifier si pg_cron est activé :
--   select cron.schedule('purge-scan-failures', '15 3 * * *',
--     $$ select public.purge_scan_failures() $$);


-- ═══════════════════════════════════════════════════════════════════════════
-- EXPLOITATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Vue d'ensemble sur 7 jours — c'est cette requête qui aurait fait ressortir
-- le bug « le raccourci scanne mais rien ne s'affiche » :
--   select reason, os, app_version, count(*) as n
--     from scan_failures
--     where occurred_at > now() - interval '7 days'
--     group by 1, 2, 3
--     order by n desc;
--
-- Taux d'échec rapporté au volume (scan_events = scans aboutis) :
--   select
--     (select count(*) from scan_failures where occurred_at > now() - interval '24 hours') as echecs,
--     (select count(*) from scan_events   where created_at  > now() - interval '24 hours') as reussites;
