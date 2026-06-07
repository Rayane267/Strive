-- ═══════════════════════════════════════════════════════════════════════════
-- scan_events — télémétrie produit NON NOMINATIVE (taux de détection, coût Gemini)
-- ═══════════════════════════════════════════════════════════════════════════
-- But : mesurer la qualité réelle de l'OCR sur le parc (vs deviner). On logge
-- par scan quelques faits agrégeables — JAMAIS de donnée perso (pas d'adresse,
-- pas de montant exact, pas de coordonnées). Permet de répondre à :
--   - % de scans qui trouvent les 2 adresses (métrique cœur), par plateforme
--   - taux de fallback Gemini (= coût)
--   - répartition des verdicts
--
-- Pattern identique à audit_log : RLS + écriture via RPC security definer
-- (les clients n'insèrent jamais de ligne arbitraire en direct).

create table if not exists public.scan_events (
  id              bigserial primary key,
  user_id         uuid references auth.users(id) on delete set null,
  platform        text,
  addresses_found smallint check (addresses_found between 0 and 2),
  gemini_fallback boolean not null default false,
  duration_source text,        -- 'reported' (OCR/TomTom) | 'estimated'
  verdict         smallint check (verdict between 0 and 2),
  fare_bucket     text,        -- tranche, ex '10-20' (jamais le montant exact)
  created_at      timestamptz not null default now()
);

create index if not exists idx_scan_events_created
  on public.scan_events (created_at desc);
create index if not exists idx_scan_events_platform_created
  on public.scan_events (platform, created_at desc);

alter table public.scan_events enable row level security;

-- Lecture : un user voit ses propres events (transparence RGPD).
-- Les agrégats produit se font en service_role (SQL editor / dashboard).
drop policy if exists "scan_events_select_own" on public.scan_events;
create policy "scan_events_select_own"
  on public.scan_events for select
  to authenticated
  using (auth.uid() = user_id);

-- Écriture : via RPC security definer uniquement (aucune policy INSERT pour
-- authenticated → insert direct bloqué).
create or replace function public.log_scan_event(
  p_platform        text,
  p_addresses_found int,
  p_gemini_fallback boolean,
  p_duration_source text,
  p_verdict         int,
  p_fare_bucket     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.scan_events (
    user_id, platform, addresses_found, gemini_fallback,
    duration_source, verdict, fare_bucket
  ) values (
    auth.uid(),
    nullif(left(coalesce(p_platform, ''), 16), ''),
    greatest(0, least(2, coalesce(p_addresses_found, 0))),
    coalesce(p_gemini_fallback, false),
    nullif(left(coalesce(p_duration_source, ''), 16), ''),
    greatest(0, least(2, coalesce(p_verdict, 0))),
    nullif(left(coalesce(p_fare_bucket, ''), 16), '')
  );
end;
$$;

revoke execute on function public.log_scan_event(text, int, boolean, text, int, text) from public;
grant  execute on function public.log_scan_event(text, int, boolean, text, int, text) to authenticated;
