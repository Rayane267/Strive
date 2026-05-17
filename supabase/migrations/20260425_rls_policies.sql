-- ═══════════════════════════════════════════════════════════════════════════
-- Row-Level Security (RLS) — politique complète pour le schéma Strive
-- ═══════════════════════════════════════════════════════════════════════════
-- Modèle :
--   - profiles, preferences           → clé `id` = auth.uid() (1 ligne par user)
--   - rides, online_sessions, cars    → clé `user_id` = auth.uid() (N lignes)
--   - parser_config                   → lecture publique, écriture admin only
--   - vehicles_db                     → lecture publique (catalogue), écriture admin only
--
-- À exécuter dans le SQL Editor du Dashboard Supabase. Idempotent : peut être
-- ré-exécuté sans casser l'existant (DROP POLICY IF EXISTS partout).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Activer RLS sur toutes les tables ────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.preferences      enable row level security;
alter table public.rides            enable row level security;
alter table public.online_sessions  enable row level security;
alter table public.cars             enable row level security;
alter table public.parser_config    enable row level security;
alter table public.vehicles_db      enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
-- profiles — 1 ligne par user, id = auth.uid()
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  using (auth.uid() = id);


-- ═══════════════════════════════════════════════════════════════════════════
-- preferences — 1 ligne par user, id = auth.uid()
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "preferences_select_own" on public.preferences;
create policy "preferences_select_own"
  on public.preferences for select
  using (auth.uid() = id);

drop policy if exists "preferences_insert_own" on public.preferences;
create policy "preferences_insert_own"
  on public.preferences for insert
  with check (auth.uid() = id);

drop policy if exists "preferences_update_own" on public.preferences;
create policy "preferences_update_own"
  on public.preferences for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "preferences_delete_own" on public.preferences;
create policy "preferences_delete_own"
  on public.preferences for delete
  using (auth.uid() = id);


-- ═══════════════════════════════════════════════════════════════════════════
-- rides — N lignes par user, user_id = auth.uid()
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "rides_select_own" on public.rides;
create policy "rides_select_own"
  on public.rides for select
  using (auth.uid() = user_id);

drop policy if exists "rides_insert_own" on public.rides;
create policy "rides_insert_own"
  on public.rides for insert
  with check (auth.uid() = user_id);

drop policy if exists "rides_update_own" on public.rides;
create policy "rides_update_own"
  on public.rides for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "rides_delete_own" on public.rides;
create policy "rides_delete_own"
  on public.rides for delete
  using (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- online_sessions — N lignes par user, user_id = auth.uid()
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "online_sessions_select_own" on public.online_sessions;
create policy "online_sessions_select_own"
  on public.online_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "online_sessions_insert_own" on public.online_sessions;
create policy "online_sessions_insert_own"
  on public.online_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "online_sessions_update_own" on public.online_sessions;
create policy "online_sessions_update_own"
  on public.online_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "online_sessions_delete_own" on public.online_sessions;
create policy "online_sessions_delete_own"
  on public.online_sessions for delete
  using (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- cars — N lignes par user (un user peut avoir plusieurs véhicules)
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "cars_select_own" on public.cars;
create policy "cars_select_own"
  on public.cars for select
  using (auth.uid() = user_id);

drop policy if exists "cars_insert_own" on public.cars;
create policy "cars_insert_own"
  on public.cars for insert
  with check (auth.uid() = user_id);

drop policy if exists "cars_update_own" on public.cars;
create policy "cars_update_own"
  on public.cars for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cars_delete_own" on public.cars;
create policy "cars_delete_own"
  on public.cars for delete
  using (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- parser_config — config OCR partagée entre tous les users (read-only client)
-- L'écriture passe par le service_role (depuis Supabase Studio ou edge function)
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "parser_config_select_authenticated" on public.parser_config;
create policy "parser_config_select_authenticated"
  on public.parser_config for select
  to authenticated
  using (true);

-- Pas de policy INSERT/UPDATE/DELETE → bloqué pour authenticated.
-- Le service_role bypasse RLS, donc tu peux mettre à jour depuis le Dashboard.


-- ═══════════════════════════════════════════════════════════════════════════
-- vehicles_db — catalogue marques/modèles (lecture publique authentifiée)
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "vehicles_db_select_authenticated" on public.vehicles_db;
create policy "vehicles_db_select_authenticated"
  on public.vehicles_db for select
  to authenticated
  using (true);

-- Pas de policy INSERT/UPDATE/DELETE → réservé au service_role.


-- ═══════════════════════════════════════════════════════════════════════════
-- BONUS : trigger pour créer automatiquement le profil + preferences à la
-- création d'un user dans auth.users. Évite "no row found" au premier login.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, created_at)
  values (new.id, new.email, now())
  on conflict (id) do nothing;

  insert into public.preferences (id, created_at, updated_at)
  values (new.id, now(), now())
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ═══════════════════════════════════════════════════════════════════════════
-- BONUS : ON DELETE CASCADE — quand on supprime auth.users, on cascade
-- automatiquement sur les FK qui référencent auth.users.id. Évite d'avoir
-- à maintenir l'ordre dans delete_account() RPC.
-- À exécuter UNIQUEMENT si tes FK n'ont pas déjà cette contrainte.
-- ═══════════════════════════════════════════════════════════════════════════
-- Décommenter et adapter selon le nom exact de tes FK constraints :
--
-- alter table public.profiles
--   drop constraint if exists profiles_id_fkey,
--   add constraint profiles_id_fkey
--     foreign key (id) references auth.users(id) on delete cascade;
--
-- alter table public.preferences
--   drop constraint if exists preferences_id_fkey,
--   add constraint preferences_id_fkey
--     foreign key (id) references auth.users(id) on delete cascade;
--
-- alter table public.rides
--   drop constraint if exists rides_user_id_fkey,
--   add constraint rides_user_id_fkey
--     foreign key (user_id) references auth.users(id) on delete cascade;
--
-- alter table public.online_sessions
--   drop constraint if exists online_sessions_user_id_fkey,
--   add constraint online_sessions_user_id_fkey
--     foreign key (user_id) references auth.users(id) on delete cascade;
--
-- alter table public.cars
--   drop constraint if exists cars_user_id_fkey,
--   add constraint cars_user_id_fkey
--     foreign key (user_id) references auth.users(id) on delete cascade;


-- ═══════════════════════════════════════════════════════════════════════════
-- TEST (à exécuter en tant que user authentifié pour vérifier) :
-- ═══════════════════════════════════════════════════════════════════════════
-- select * from public.rides where user_id != auth.uid();   -- doit retourner 0 lignes
-- insert into public.rides (user_id, ...) values ('<other_uid>', ...);  -- doit échouer
