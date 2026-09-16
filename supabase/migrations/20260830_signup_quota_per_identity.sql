-- ═══════════════════════════════════════════════════════════════════════════
-- Quota d'inscription : compter les identités, pas les inscriptions
-- ═══════════════════════════════════════════════════════════════════════════
-- LE BUG. `check_and_register_device_signup` compte les LIGNES de
-- `device_signups` sur 60 jours. Un chauffeur qui supprime son compte puis le
-- recrée avec le même email consomme donc un slot à chaque fois, alors qu'il
-- n'a jamais eu qu'un seul compte. Au troisième aller-retour il est refusé —
-- et comme `AuthScreen.checkNewUserQuota` fait `signOut()` sur ce refus, il est
-- renvoyé sur la page de connexion sans comprendre pourquoi.
--
-- C'est le droit à l'effacement qui se retourne contre son bénéficiaire : on
-- lui supprime tout, puis on lui refuse de revenir.
--
-- LE CORRECTIF. Le quota porte sur le nombre d'IDENTITÉS DISTINCTES vues sur
-- l'appareil, pas sur le nombre de passages. Revenir avec un email déjà connu
-- de cet appareil ne coûte rien et n'est jamais refusé. Créer un compte avec un
-- email neuf coûte un slot, comme avant — l'abus visé (enchaîner les adresses
-- Gmail pour rejouer le gratuit) reste borné à 3.
--
-- POURQUOI UN HASH ET PAS L'EMAIL. `device_signups` est une table anti-abus, la
-- seule que la suppression de compte ne vide PAS. Y écrire des adresses en
-- clair y ferait survivre une donnée personnelle à l'effacement, ce qui est
-- exactement ce qu'on ne veut pas. Un SHA-256 suffit à reconnaître un retour
-- sans conserver l'identité : on ne peut pas le lire, seulement le recomparer.
--
-- Le cadeau de bienvenue n'est pas concerné : `welcome_grants` a le device_id
-- en clé primaire et ne se rouvre jamais. Un retour ne re-crédite rien.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.device_signups
  add column if not exists email_hash text;

-- Recherche d'un retour : (appareil, identité). Pas unique — un même couple
-- peut légitimement réapparaître, c'est justement le cas qu'on autorise.
create index if not exists idx_device_signups_device_email
  on public.device_signups (device_id, email_hash)
  where email_hash is not null;


create or replace function public.check_and_register_device_signup(
  p_device_id  text,
  p_email_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_count int;
  window_start timestamptz := now() - interval '60 days';
begin
  if p_device_id is null or length(p_device_id) < 16 then
    raise exception 'invalid_device_id' using errcode = 'P0001';
  end if;

  -- Retour d'une identité déjà connue de cet appareil : rien à compter, rien à
  -- enregistrer. Sortie avant tout comptage — c'est ce qui rend la suppression
  -- de compte réellement réversible.
  if p_email_hash is not null and exists (
       select 1 from public.device_signups
        where device_id = p_device_id
          and email_hash = p_email_hash
     ) then
    return;
  end if;

  -- Identités distinctes vues sur l'appareil dans la fenêtre. Les lignes sans
  -- hash sont celles d'avant cette migration : chacune compte pour une, faute
  -- de mieux — on ne peut pas deviner après coup à qui elles appartenaient.
  select count(distinct coalesce(email_hash, id::text))
    into distinct_count
    from public.device_signups
   where device_id = p_device_id
     and created_at >= window_start;

  if distinct_count >= 3 then
    raise exception 'device_signup_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.device_signups (device_id, email_hash)
    values (p_device_id, p_email_hash);
end;
$$;

-- L'ancienne signature à un seul argument disparaît : la laisser vivre ferait
-- silencieusement retomber un client non mis à jour sur le comptage par
-- passages, c'est-à-dire sur le bug qu'on corrige.
drop function if exists public.check_and_register_device_signup(text);

revoke execute on function public.check_and_register_device_signup(text, text) from public;
grant execute on function public.check_and_register_device_signup(text, text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Un retour ne coûte rien :
--    select check_and_register_device_signup('aaaaaaaaaaaaaaaa-t', 'hash-A'); -- 1 identité
--    select check_and_register_device_signup('aaaaaaaaaaaaaaaa-t', 'hash-A'); -- retour
--    select count(*) from device_signups where device_id = 'aaaaaaaaaaaaaaaa-t';
--    → 1 ligne : le second appel n'a rien inséré
--
-- 2. Trois identités passent, la quatrième non :
--    …('aaaaaaaaaaaaaaaa-t','hash-B'); …('aaaaaaaaaaaaaaaa-t','hash-C');  -- ok
--    …('aaaaaaaaaaaaaaaa-t','hash-D');
--    → ERROR: device_signup_limit_reached
--
-- 3. Mais le retour de A passe toujours, quota plein ou non :
--    select check_and_register_device_signup('aaaaaaaaaaaaaaaa-t', 'hash-A');
--    → OK
--
-- 4. Nettoyage :
--    delete from device_signups where device_id = 'aaaaaaaaaaaaaaaa-t';
