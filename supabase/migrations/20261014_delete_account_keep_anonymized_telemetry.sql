-- ═══════════════════════════════════════════════════════════════════════════
-- delete_account : garder les échecs et les stats de scan, anonymisés
-- ═══════════════════════════════════════════════════════════════════════════
-- Le 2026-10-14, un chauffeur touché par le crash de la 1.0.4 a supprimé son
-- compte : ses échecs de scan sont partis avec lui, et avec eux ce qu'ils
-- disaient du parc. La suppression doit couper le lien avec la personne, pas
-- effacer la mesure.
--
-- Deux tables passent donc de DELETE à anonymisation :
--   • scan_failures — `user_id` vidé, et `detail` aussi : c'est un texte libre
--     que rien ne garantit exempt de donnée personnelle (la raison pour
--     laquelle 20260830 supprimait la ligne). Restent le motif, l'OS, la
--     surface, la plateforme, la version et la date.
--   • scan_events — `user_id` vidé. Le reste n'est que des valeurs codées
--     (plateforme, verdict, tarif en TRANCHE, nombre d'adresses lues).
--
-- Rien d'autre ne change. scan_debug reste supprimé : il porte le texte OCR de
-- l'écran, donc les adresses des passagers. Courses, sessions, voitures,
-- préférences et profil aussi. La console admin lit ces tables en
-- `left join` : les lignes anonymisées y restent comptées, sans chauffeur.
--
-- Le reste de la fonction est recopié à l'identique de 20260830.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid            uuid;
  v_removed      int;
  v_identities   int;
  v_storage      int := 0;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  -- ── 1. Données personnelles ───────────────────────────────────────────────
  -- to_regclass : une table absente n'a pas à faire échouer l'effacement.
  if to_regclass('public.scan_debug')      is not null then delete from public.scan_debug      where user_id = uid; end if;
  -- Anonymisées plutôt que supprimées : la mesure reste, le lien à la personne
  -- part. `detail` est vidé, c'est un texte libre.
  if to_regclass('public.scan_events')     is not null then update public.scan_events   set user_id = null              where user_id = uid; end if;
  if to_regclass('public.scan_failures')   is not null then update public.scan_failures set user_id = null, detail = null where user_id = uid; end if;
  if to_regclass('public.online_sessions') is not null then delete from public.online_sessions where user_id = uid; end if;
  if to_regclass('public.cars')            is not null then delete from public.cars            where user_id = uid; end if;
  delete from public.rides       where user_id = uid;
  delete from public.preferences where id = uid;
  delete from public.profiles    where id = uid;

  -- ── 2. Fichiers du Storage (avatar) ───────────────────────────────────────
  -- Filet de sécurité derrière la purge client. Supprimer la ligne laisse
  -- l'objet orphelin côté S3 — quelques kilo-octets sans propriétaire, contre
  -- un compte impossible à supprimer : l'arbitrage n'en est pas un. Le chemin
  -- propre reste celui du client, qui passe par l'API Storage.
  if to_regclass('storage.objects') is not null then
    begin
      delete from storage.objects where owner = uid;
      get diagnostics v_storage = row_count;
    exception when insufficient_privilege then
      -- La fonction n'a pas les droits sur storage : on n'échoue pas pour
      -- autant, le delete d'auth.users dira s'il en reste un bloqueur.
      v_storage := -1;
    end;
  end if;

  -- ── 3. Le compte lui-même ─────────────────────────────────────────────────
  begin
    delete from auth.users where id = uid;
    get diagnostics v_removed = row_count;
  exception
    when foreign_key_violation then
      -- Le message brut de Postgres nomme la contrainte : on le remonte tel
      -- quel, c'est exactement ce qu'il faut pour savoir quelle table bloque.
      raise exception 'delete_account_blocked_by_fk: %', SQLERRM using errcode = 'P0001';
    when insufficient_privilege then
      raise exception 'delete_account_no_privilege_on_auth_users' using errcode = 'P0001';
  end;

  -- ── 4. Vérification ───────────────────────────────────────────────────────
  -- Sans ça, « 0 ligne supprimée » se lit comme un succès et le chauffeur
  -- repart en croyant son compte effacé.
  if v_removed = 0 or exists (select 1 from auth.users where id = uid) then
    raise exception 'delete_account_user_still_present' using errcode = 'P0001';
  end if;

  -- Les identités Google / Apple doivent être tombées avec l'utilisateur
  -- (ON DELETE CASCADE). Si l'une survit, l'email reste rattaché au fournisseur
  -- et la ré-inscription échouera plus tard, loin d'ici : on préfère le savoir
  -- maintenant.
  select count(*) into v_identities from auth.identities where user_id = uid;
  if v_identities > 0 then
    raise exception 'delete_account_identities_left: %', v_identities using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'storage_rows', v_storage
  );
end;
$$;

revoke execute on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;
