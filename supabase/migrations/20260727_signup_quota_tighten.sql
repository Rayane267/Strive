-- ═══════════════════════════════════════════════════════════════════════════
-- Quota d'inscription par appareil : 5 → 3
-- ═══════════════════════════════════════════════════════════════════════════
-- 5 comptes sur 60 jours laissait 15 scans gratuits par jour à qui prenait la
-- peine d'enchaîner les inscriptions — l'app n'ayant que 3 scans/jour en offre
-- gratuite, c'était l'abus le plus rentable possible.
--
-- 3 reste au-dessus des usages légitimes connus : un téléphone d'occasion, un
-- compte professionnel puis personnel, une réinstallation ratée. Au-delà, c'est
-- un comportement délibéré.
--
-- Le compteur est cumulé toutes méthodes confondues : Google et Apple tapent
-- dans le même quota, puisqu'il est indexé sur l'appareil et non sur le provider.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.check_and_register_device_signup(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
  window_start timestamptz := now() - interval '60 days';
begin
  if p_device_id is null or length(p_device_id) < 16 then
    raise exception 'invalid_device_id' using errcode = 'P0001';
  end if;

  select count(*) into recent_count
    from public.device_signups
    where device_id = p_device_id
      and created_at >= window_start;

  if recent_count >= 3 then
    raise exception 'device_signup_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.device_signups (device_id) values (p_device_id);
end;
$$;

revoke execute on function public.check_and_register_device_signup(text) from public;
grant execute on function public.check_and_register_device_signup(text) to anon, authenticated;
