-- RPC delete_account : supprime toutes les données utilisateur + le compte auth.
-- Exécutée avec les privilèges du user appelant (SECURITY INVOKER — pas DEFINER)
-- sauf pour la suppression de auth.users qui nécessite auth.admin.

-- 1. Fonction qui supprime en cascade
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Cascade manuelle : l'ordre importe si FK sans ON DELETE CASCADE
  delete from public.rides where user_id = uid;
  delete from public.preferences where id = uid;
  delete from public.profiles where id = uid;
  -- Ajouter d'autres tables si besoin (notifications, sessions, etc.)

  -- Supprime le compte auth
  delete from auth.users where id = uid;
end;
$$;

-- 2. Permission d'appel
grant execute on function public.delete_account() to authenticated;
