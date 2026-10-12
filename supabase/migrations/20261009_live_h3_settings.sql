-- ════════════════════════════════════════════════════════════════════════════
-- Carte en direct — réglages H3
--
-- Le direct est désormais calculé par l'Edge Function `community-live`, avec
-- h3-js, la bibliothèque H3 d'Uber (l'extension Postgres h3 n'existe pas sur
-- Supabase). Elle lit ces deux réglages en plus de ceux de 20261008 :
--
--   h3_res           résolution des cellules H3 (8 ≈ 460 m de côté, celle des
--                    cartes de chaleur VTC ; 7 plus grossier, 9 plus fin)
--   neighbor_weight  part de la demande de chaque cellule voisine ajoutée à une
--                    cellule (0 = cellules brutes, 0.35 = zones continues)
--   half_life_minutes  une offre compte moitié moins tous les N minutes : une
--                    zone qui se vide refroidit vite, une zone qui démarre
--                    chauffe tout de suite
--
-- `cell_m` n'est plus lu par le direct : la taille vient de `h3_res`.
-- La fonction SQL `community_live` reste en place pour les builds déjà sortis.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.live_map_settings
  add column if not exists h3_res smallint not null default 8
    check (h3_res between 6 and 10),
  add column if not exists neighbor_weight real not null default 0.35
    check (neighbor_weight between 0 and 1),
  add column if not exists half_life_minutes real not null default 10
    check (half_life_minutes between 2 and 120);

comment on column public.live_map_settings.h3_res is
  'Resolution H3 des cellules de la carte en direct (Edge Function community-live).';
comment on column public.live_map_settings.neighbor_weight is
  'Part de la demande de chaque cellule voisine ajoutee a une cellule (0 = aucun lissage).';
comment on column public.live_map_settings.half_life_minutes is
  'Demi-vie du poids d''une offre dans le direct, en minutes.';

-- ════════════════════════════════════════════════════════════════════════════
-- Utilisation
--
--   update live_map_settings set neighbor_weight = 0.5;  -- zones plus fondues
--   update live_map_settings set h3_res = 7;             -- cellules plus grandes
--   update live_map_settings set half_life_minutes = 5;  -- direct plus nerveux
-- ════════════════════════════════════════════════════════════════════════════
