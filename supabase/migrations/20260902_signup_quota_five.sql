-- ═══════════════════════════════════════════════════════════════════════════
-- Quota d'inscription : 3 → 5 identités par appareil
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI. Trois identités par appareil sur 60 jours, c'était calibré sur
-- l'abusif — enchaîner des adresses Gmail pour rejouer le palier gratuit — sans
-- regarder l'honnête. Or trois, c'est peu :
--
--   • un iPhone de démonstration montré à quelques chauffeurs,
--   • un téléphone qui passe d'un conjoint à l'autre,
--   • et surtout l'appareil de l'équipe de vérification d'Apple, qui a déjà pu
--     servir lors d'une soumission précédente.
--
-- Dans ces trois cas la personne se heurte à `device_signup_limit_reached`
-- AVANT d'avoir vu l'app, sur un message qui ne lui explique rien et que rien
-- ne lui permet de contourner : `delete_account` ne rouvre pas de slot, c'est
-- délibéré (la table anti-abus est la seule que l'effacement ne vide pas).
-- Un reviewer bloqué là, c'est un rejet sans appel.
--
-- CE QUE ÇA COÛTE. Le fraudeur passe de 3 à 5 comptes gratuits par appareil et
-- par 60 jours, soit 6 scans/jour supplémentaires au pire. Le plafond n'a
-- jamais été la seule barrière : `welcome_grants` a le device_id en clé
-- primaire et ne se rouvre JAMAIS, donc les crédits de bienvenue ne se
-- rejouent pas, quota ou pas. C'est là qu'est la vraie valeur volée, et elle
-- reste hors d'atteinte.
--
-- Le reste de la fonction est inchangé : comptage par identités distinctes,
-- sortie anticipée sur un retour connu, hash jamais l'adresse. Voir
-- 20260830_signup_quota_per_identity.sql pour ces choix-là.
--
-- ⚠️ Le seuil est écrit DEUX FOIS : ici, et dans `enforceOAuthSignupQuota`
-- (src/utils/deviceId.ts). Les deux doivent bouger ensemble — un écart ferait
-- qu'une seule des deux barrières bloque, et le diagnostic deviendrait
-- illisible.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- hash sont celles d'avant la migration du 30/08 : chacune compte pour une,
  -- faute de mieux — on ne peut pas deviner après coup à qui elles appartenaient.
  select count(distinct coalesce(email_hash, id::text))
    into distinct_count
    from public.device_signups
   where device_id = p_device_id
     and created_at >= window_start;

  if distinct_count >= 5 then
    raise exception 'device_signup_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.device_signups (device_id, email_hash)
    values (p_device_id, p_email_hash);
end;
$$;

revoke execute on function public.check_and_register_device_signup(text, text) from public;
grant execute on function public.check_and_register_device_signup(text, text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Quatre identités neuves passent, la sixième est refusée :
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h1');
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h2');
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h3');
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h4');
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h5');
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h6'); -- device_signup_limit_reached
--
-- 2. Le retour d'une identité connue passe toujours, quota plein ou non :
--    select check_and_register_device_signup('bbbbbbbbbbbbbbbb-t', 'h1'); -- OK
--
-- 3. Nettoyage :
--    delete from device_signups where device_id = 'bbbbbbbbbbbbbbbb-t';
