-- ════════════════════════════════════════════════════════════════════════════
-- city_signals.items — liste des trains d'une gare (et tout détail affiché)
--
-- La colonne a été ajoutée à 20261010_city_signals.sql APRÈS que cette
-- migration eut été appliquée en production : la base ne l'avait jamais reçue,
-- et `replace_city_signals` (version d'origine) jetait silencieusement la liste
-- des trains. Résultat : une vague « 4 trains » qui ne montrait aucun train.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.city_signals add column if not exists items jsonb;

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
