-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — quota d'inscription : retour de 5 à 3 identités par appareil
-- ═══════════════════════════════════════════════════════════════════════════
-- Restaure la fonction telle que 20260830_signup_quota_per_identity.sql
-- l'a laissée. Rien d'autre à défaire : la migration du 02/09 n'a touché ni la
-- table, ni les index, ni les droits — seulement la constante du plafond.
--
-- ⚠️ Repasser à 3 sans redescendre `enforceOAuthSignupQuota`
-- (src/utils/deviceId.ts) laisserait la barrière locale autoriser une 4e et une
-- 5e identité que le serveur refuserait. Le chauffeur verrait alors le refus
-- APRÈS `signInWithIdToken`, donc après un compte déjà créé côté Auth. Les deux
-- seuils descendent ensemble ou pas du tout.
--
-- ⚠️ Les appareils qui ont profité du plafond à 5 gardent leurs 4e et 5e
-- identités : ce rollback ne supprime aucune ligne de `device_signups`. Ils
-- seront simplement au-dessus du quota et refusés à la prochaine inscription,
-- jusqu'à ce que la fenêtre de 60 jours les fasse redescendre.
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

  if p_email_hash is not null and exists (
       select 1 from public.device_signups
        where device_id = p_device_id
          and email_hash = p_email_hash
     ) then
    return;
  end if;

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

revoke execute on function public.check_and_register_device_signup(text, text) from public;
grant execute on function public.check_and_register_device_signup(text, text) to anon, authenticated;
