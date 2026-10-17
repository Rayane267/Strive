-- ═══════════════════════════════════════════════════════════════════════════
-- app_release : la version publiée, pour l'écran « Mise à jour disponible »
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une ligne par plateforme. L'app la lit à l'ouverture : si la version
-- installée est plus ancienne que `latest_version`, elle PROPOSE la mise à jour.
-- Jamais imposée : « Plus tard » la fait taire 24 h pour cette version.
--
-- Tenue à la main APRÈS chaque publication validée par le store — jamais avant :
-- proposer une version que le store ne sert pas encore enverrait le chauffeur
-- sur une fiche sans mise à jour.
--
--   update public.app_release
--      set latest_version = '1.0.6',
--          notes = '{"fr": ["Les longues courses sont lues", "Heetch : le prix du bouton Accepter"],
--                    "en": ["Long rides are read", "Heetch: the Accept button price"]}',
--          updated_at = now()
--    where platform = 'ios';
--
-- `notes` : une liste courte par langue (code à deux lettres). L'app prend la
-- langue du chauffeur, sinon l'anglais, sinon le français, sinon rien.
--
-- Lisible SANS compte : l'écran s'affiche aussi avant la connexion.

create table if not exists public.app_release (
  platform       text primary key check (platform in ('ios', 'android')),
  latest_version text not null,
  notes          jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

alter table public.app_release enable row level security;

drop policy if exists "app_release_read" on public.app_release;
create policy "app_release_read"
  on public.app_release for select
  to anon, authenticated
  using (true);

-- Les versions actuellement en store : aucun écran ne s'affiche tant qu'on ne
-- les relève pas.
insert into public.app_release (platform, latest_version)
values ('ios', '1.0.5'),
       ('android', '1.0.4')
on conflict (platform) do nothing;
