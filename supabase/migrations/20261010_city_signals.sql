-- ════════════════════════════════════════════════════════════════════════════
-- Vue « Afflux » — signaux de demande par ville
--
-- Une ligne = un fait observable qui pousse des voyageurs vers les VTC : une
-- ligne de RER coupée, une vague de TGV qui arrive, une fin de concert, une
-- grève confirmée la veille. Ce n'est PAS une prédiction : chaque ligne vient
-- d'une source publique nommée dans `source`.
--
-- Remplie par l'edge function `city-pulse` (cron toutes les 5 min). Chaque
-- source remplace en bloc ses propres lignes via `replace_city_signals` : une
-- perturbation levée disparaît au passage suivant, sans purge à part.
--
-- Effet voulu : la table sert aussi d'historique d'entraînement pour un futur
-- modèle de zones chaudes. C'est pour ça que `city_signals_log` garde une copie
-- datée de chaque signal vu, même après sa disparition de la vue en direct.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.city_signals (
  id          text primary key,              -- '<source>:<id externe>'
  source      text not null,                 -- 'idfm', 'sncf', …
  city        text not null,                 -- 'paris', 'lyon', 'marseille', 'nice'
  kind        text not null,                 -- 'transit_disruption', 'train_arrivals', 'event', 'strike'
  title       text not null,
  detail      text,
  place       text,                          -- ligne ou lieu affiché (« RER B », « Gare de Lyon »)
  mode        text,                          -- 'rer', 'metro', 'tram', 'train' pour les transports
  lat         double precision,
  lon         double precision,
  starts_at   timestamptz,
  ends_at     timestamptz,
  intensity   smallint not null check (intensity between 1 and 5),
  items       jsonb,                         -- détail affiché (ex. liste des trains d'une vague)
  updated_at  timestamptz not null default now()
);

create index if not exists city_signals_city_idx on public.city_signals (city, intensity desc);

create table if not exists public.city_signals_log (
  id          text not null,
  seen_on     date not null default (now() at time zone 'Europe/Paris')::date,
  source      text not null,
  city        text not null,
  kind        text not null,
  title       text not null,
  place       text,
  mode        text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  intensity   smallint not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (id, seen_on)
);

alter table public.city_signals enable row level security;
alter table public.city_signals_log enable row level security;

-- Lecture pour tout chauffeur connecté. Aucune écriture client : seul le
-- service_role (edge function) écrit, via la RPC ci-dessous.
drop policy if exists city_signals_read on public.city_signals;
create policy city_signals_read on public.city_signals
  for select to authenticated using (true);
-- `city_signals_log` : aucune policy, donc aucun accès client.

-- ── Remplacement atomique des lignes d'une source ──────────────────────────
-- `p_rows` : tableau JSON d'objets aux clés de `city_signals`. Les dates
-- arrivent en heure locale sans fuseau (« 2026-10-07T18:05:00 », le format des
-- API Navitia) et sont lues comme heure de Paris — les quatre villes y sont.
create or replace function public.replace_city_signals(p_source text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.city_signals where source = p_source;

  insert into public.city_signals
    (id, source, city, kind, title, detail, place, mode, lat, lon, starts_at, ends_at, intensity, items)
  select p_source || ':' || (r->>'id'),
         p_source,
         r->>'city',
         r->>'kind',
         r->>'title',
         r->>'detail',
         r->>'place',
         r->>'mode',
         (r->>'lat')::double precision,
         (r->>'lon')::double precision,
         ((r->>'starts_local')::timestamp at time zone 'Europe/Paris'),
         ((r->>'ends_local')::timestamp at time zone 'Europe/Paris'),
         least(5, greatest(1, (r->>'intensity')::smallint)),
         r->'items'
    from jsonb_array_elements(p_rows) r
  on conflict (id) do nothing;

  get diagnostics v_count = row_count;

  insert into public.city_signals_log
    (id, source, city, kind, title, place, mode, starts_at, ends_at, intensity)
  select id, source, city, kind, title, place, mode, starts_at, ends_at, intensity
    from public.city_signals
   where source = p_source
  on conflict (id, seen_on) do update
     set last_seen = now(),
         intensity = excluded.intensity;

  return v_count;
end;
$$;

revoke all on function public.replace_city_signals(text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_city_signals(text, jsonb) to service_role;

-- ── Planification (pg_cron + pg_net), même montage que notify-untagged ─────
--   PRÉREQUIS : Vault `project_url` + `service_role_key` (déjà en place),
--   et le secret d'edge function PRIM_API_KEY.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then

    if exists (select 1 from cron.job where jobname = 'city-pulse') then
      perform cron.unschedule('city-pulse');
    end if;

    perform cron.schedule(
      'city-pulse',
      '*/5 * * * *',
      $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/city-pulse',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Vérifications
--   select kind, place, title, intensity from city_signals where city = 'paris'
--    order by intensity desc;
--   select * from cron.job_run_details where jobid =
--     (select jobid from cron.job where jobname = 'city-pulse')
--    order by start_time desc limit 5;
-- ════════════════════════════════════════════════════════════════════════════
