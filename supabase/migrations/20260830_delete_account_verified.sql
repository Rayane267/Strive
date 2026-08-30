-- ═══════════════════════════════════════════════════════════════════════════
-- delete_account : supprimer vraiment, et le prouver
-- ═══════════════════════════════════════════════════════════════════════════
-- CE QUI CLOCHAIT. La version de 20260629 fait `delete from auth.users` en
-- dernier et ne regarde jamais le résultat. Trois façons d'échouer en silence
-- ou en opaque :
--
--   1. UNE SEULE TRANSACTION. Si le delete final viole une FK, TOUT est annulé
--      — y compris la suppression du profil et des courses. Le chauffeur voit
--      une alerte, croit son compte supprimé, et retrouve tout intact. C'est le
--      pire des deux mondes : ni supprimé, ni prévenu correctement.
--
--   2. storage.objects. L'avatar est purgé côté client AVANT l'appel, en
--      best-effort avalé par un `catch {}` (ProfileScreen). Si cette purge
--      échoue — réseau, session, fichier hors du préfixe attendu — les lignes
--      `storage.objects` restent, et selon la version de Supabase leur FK
--      `owner` bloque le delete de auth.users. Silencieusement, côté client.
--
--   3. 0 LIGNE SUPPRIMÉE = SUCCÈS. `returns void` ne distingue pas « supprimé »
--      de « rien trouvé ». Impossible de diagnostiquer sans accès à la base.
--
-- CE QUE FAIT CETTE VERSION. Elle enlève les bloqueurs connus avant d'attaquer
-- auth.users, elle VÉRIFIE que la ligne a disparu, et elle renomme l'échec :
-- une violation de FK ressort avec le nom de la contrainte fautive au lieu d'un
-- message Postgres illisible. La transaction unique est conservée — c'est la
-- bonne propriété (pas de suppression à moitié faite), elle devient juste
-- diagnosticable.
--
-- OAUTH (Google / Apple). `auth.identities` référence `auth.users(id)` en
-- ON DELETE CASCADE : supprimer l'utilisateur détache donc les deux fournisseurs
-- et libère l'email pour une future inscription. Le contrôle est fait
-- explicitement plus bas — si une identité survivait, la fonction refuserait de
-- prétendre que le compte est supprimé.
--
-- ⚠️ CE QUE LA BASE NE PEUT PAS FAIRE : révoquer le jeton Apple. Apple l'exige
-- (App Store Review 5.1.1(v)) et cela se fait depuis l'appareil, pas depuis
-- Postgres. Voir le suivi côté app.
-- ═══════════════════════════════════════════════════════════════════════════

-- Le type de retour change (void → jsonb) : il faut retirer l'ancienne d'abord.
drop function if exists public.delete_account();

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
  if to_regclass('public.scan_events')     is not null then delete from public.scan_events     where user_id = uid; end if;
  -- Ajout : les échecs de scan portent un `detail` libre (motif brut, code
  -- d'erreur) que rien ne garantit exempt de donnée personnelle.
  if to_regclass('public.scan_failures')   is not null then delete from public.scan_failures   where user_id = uid; end if;
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


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFIER L'ÉTAT ACTUEL — à passer dans le SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
-- Ces requêtes répondent à « est-ce que ça supprime vraiment, Google et Apple
-- compris ». À exécuter AVANT de rejouer un test de suppression.
--
-- 1. Les comptes encore présents et leur fournisseur :
--    select u.id, u.email, u.created_at, i.provider
--      from auth.users u
--      left join auth.identities i on i.user_id = u.id
--     order by u.created_at desc;
--
-- 2. Identités orphelines (ne doit JAMAIS rien renvoyer) :
--    select i.* from auth.identities i
--     where not exists (select 1 from auth.users u where u.id = i.user_id);
--
-- 3. Profils orphelins — c'est eux qui bloquent une ré-inscription via
--    l'index unique idx_profiles_email_normalized_unique :
--    select p.id, p.email from public.profiles p
--     where not exists (select 1 from auth.users u where u.id = p.id);
--    → nettoyage si besoin : delete from public.profiles where id in (…);
--
-- 4. Ce que la FK de storage bloquerait :
--    select count(*) from storage.objects where owner is not null
--      and not exists (select 1 from auth.users u where u.id = owner);
--
-- 5. Les compteurs anti-abus du device (ils NE sont PAS vidés à la suppression,
--    c'est voulu — mais ce sont eux qui renvoyaient sur la page de connexion) :
--    select * from public.device_signups order by created_at desc limit 20;
