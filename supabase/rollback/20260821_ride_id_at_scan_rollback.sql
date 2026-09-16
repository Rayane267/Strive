-- Rollback de 20260821_ride_id_at_scan.sql
--
-- Recrée le trigger anti-doublon. À n'exécuter QU'AVEC un client antérieur à la
-- refonte : les builds qui frappent l'id au scan n'en ont pas besoin, et ce
-- trigger refuse deux offres réellement distinctes portant les mêmes chiffres à
-- moins de 90 s d'intervalle.
--
-- L'index unique `rides_user_scan_ts_uq` n'est pas concerné : la migration ne le
-- supprime pas.

create or replace function public.skip_duplicate_ride()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.scan_ts is not null then
    if exists (
      select 1
        from public.rides
       where user_id = new.user_id
         and scan_ts = new.scan_ts
    ) then
      return null;
    end if;
    return new;
  end if;

  if exists (
    select 1
      from public.rides
     where user_id        = new.user_id
       and platform       = new.platform
       and fare_estimated = new.fare_estimated
       and distance_km    = new.distance_km
       and scan_ts is null
       and created_at     > now() - interval '90 seconds'
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists aa_skip_duplicate_ride on public.rides;
create trigger aa_skip_duplicate_ride
  before insert on public.rides
  for each row execute function public.skip_duplicate_ride();
