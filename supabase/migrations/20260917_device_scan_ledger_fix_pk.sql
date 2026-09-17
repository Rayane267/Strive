-- ═══════════════════════════════════════════════════════════════════════════
-- Correctif : device_scan_ledger.user_id ne peut pas être dans la clé primaire
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'ERREUR. `20260917_device_scan_ledger.sql` déclare :
--
--     user_id uuid references auth.users(id) on delete set null,
--     primary key (device_id, day, user_id)
--
-- Les deux lignes se contredisent. En PostgreSQL, toute colonne d'une clé
-- primaire est implicitement `NOT NULL` : l'action référentielle `SET NULL` ne
-- peut donc jamais aboutir. À la suppression d'un compte, le moteur tente de
-- mettre `user_id` à NULL, la contrainte le refuse, et c'est le DELETE ENTIER
-- qui échoue :
--
--     null value in column "user_id" of relation "device_scan_ledger"
--     violates not-null constraint
--
-- Conséquence directe : `delete_account` était cassé. Or la suppression de
-- compte est une EXIGENCE App Store pour toute app qui permet d'en créer un —
-- c'est précisément ce que le reviewer va tester.
--
-- LE CORRECTIF. La clé primaire devient un identifiant technique, et l'unicité
-- (appareil, jour, compte) passe par un index — qui, lui, tolère les NULL.
--
-- Une ligne anonymisée reste comptée : c'est tout l'intérêt du `SET NULL`. Le
-- registre doit continuer de savoir que cet appareil a consommé ces scans, même
-- quand le compte qui les a consommés n'existe plus — sinon il se contourne par
-- le geste exact qu'il est censé couvrir.
--
-- Les NULL étant DISTINCTS pour un index unique, deux comptes supprimés le même
-- jour sur le même appareil laissent deux lignes anonymes. C'est voulu : elles
-- s'additionnent dans le total, et aucun upsert ne les vise jamais —
-- `record_device_scan` n'écrit que sous un `user_id` renseigné.

alter table public.device_scan_ledger
  drop constraint if exists device_scan_ledger_pkey;

alter table public.device_scan_ledger
  add column if not exists id bigint generated always as identity;

-- `NOT VALID` inutile ici : la table est neuve et minuscule. Si elle contenait
-- déjà des lignes, `generated always as identity` les a renumérotées à l'ajout
-- de la colonne.
alter table public.device_scan_ledger
  add constraint device_scan_ledger_pkey primary key (id);

-- La colonne redevient nullable — `SET NULL` a maintenant le droit d'aboutir.
alter table public.device_scan_ledger
  alter column user_id drop not null;

-- L'unicité qui porte l'upsert de `record_device_scan`. Index et non contrainte :
-- une contrainte UNIQUE se comporte pareil vis-à-vis des NULL, mais l'index
-- documente mieux qu'on vise ici le chemin d'écriture.
create unique index if not exists device_scan_ledger_device_day_user_key
  on public.device_scan_ledger (device_id, day, user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- `user_id` est bien nullable :
--   select column_name, is_nullable
--     from information_schema.columns
--    where table_name = 'device_scan_ledger' and column_name = 'user_id';
--   → YES
--
-- La suppression de compte repasse. Sur un compte de test :
--   select public.delete_account();
--   → pas d'erreur, et la ligne du registre survit avec user_id à NULL :
--   select device_id, day, user_id, scans from public.device_scan_ledger;
--
-- L'upsert fonctionne toujours (deux appels = 2 scans sur UNE ligne) :
--   select public.record_device_scan('test-device-1234567890', current_date, auth.uid());
--   select public.record_device_scan('test-device-1234567890', current_date, auth.uid());
--   select scans from public.device_scan_ledger where device_id = 'test-device-1234567890';
--   → 2
--   delete from public.device_scan_ledger where device_id = 'test-device-1234567890';


-- ═══════════════════════════════════════════════════════════════════════════
-- Durcissement : la référence à la ligne existante dans ON CONFLICT
-- ═══════════════════════════════════════════════════════════════════════════
-- La version d'origine écrivait `set scans = public.device_scan_ledger.scans + 1`.
-- Dans un `ON CONFLICT DO UPDATE`, la ligne EXISTANTE se désigne par le nom de
-- la table cible, non qualifié par son schéma. La forme qualifiée dépend de la
-- résolution de noms et n'est pas garantie.
--
-- L'enjeu n'est pas cosmétique : `record_device_scan` est appelée depuis un
-- trigger AFTER INSERT sur `rides`. Si elle lève, ce n'est pas le registre qui
-- échoue, c'est L'INSERTION DE LA COURSE qui est annulée — le chauffeur voit
-- « course non enregistrée » sur un scan que rien n'aurait dû refuser.
--
-- `excluded.scans` ne conviendrait pas : il vaut la valeur PROPOSÉE (1), pas
-- l'existante. C'est bien l'ancienne qu'on incrémente.
create or replace function public.record_device_scan(
  p_device text,
  p_day    date,
  p_user   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device is null or p_user is null then
    return;
  end if;
  insert into public.device_scan_ledger (device_id, day, user_id, scans)
       values (p_device, p_day, p_user, 1)
  on conflict (device_id, day, user_id) do update
          set scans = device_scan_ledger.scans + 1,
              updated_at = now();
end;
$$;

revoke execute on function public.record_device_scan(text, date, uuid) from public;
