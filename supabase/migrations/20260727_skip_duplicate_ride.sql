-- ═══════════════════════════════════════════════════════════════════════════
-- Course en double : dernier filet côté base
-- ═══════════════════════════════════════════════════════════════════════════
-- Le natif refuse déjà un second scan pendant qu'un pipeline tourne, et le JS
-- déduplique sur l'identité du scan. Mais ces deux gardes vivent dans l'app :
-- un appui malheureux au bon moment, une relance après crash, ou un client
-- modifié peuvent encore produire deux fois la même course.
--
-- Ici on annule silencieusement l'insertion (RETURN NULL sur un BEFORE INSERT)
-- plutôt que de lever une erreur : du point de vue du chauffeur, la course EST
-- enregistrée — elle l'a été deux secondes plus tôt. Une exception ferait
-- clignoter un message d'échec sur une opération qui a en réalité réussi.
--
-- Le triplet plateforme + tarif + distance identique à la seconde près sur une
-- fenêtre de 90 s ne correspond à aucune situation réelle : deux offres
-- distinctes n'ont jamais le même tarif au centime ET la même distance.
--
-- Nom du trigger volontairement en « aa_ » : PostgreSQL déclenche les triggers
-- BEFORE dans l'ordre alphabétique, et celui-ci doit passer AVANT
-- check_scan_quota — sinon un doublon consommerait un scan du quota avant
-- d'être écarté.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.skip_duplicate_ride()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.rides
     where user_id        = new.user_id
       and platform       = new.platform
       and fare_estimated = new.fare_estimated
       and distance_km    = new.distance_km
       and created_at     > now() - interval '90 seconds'
  ) then
    raise notice 'Doublon de course ignoré pour %', new.user_id;
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists aa_skip_duplicate_ride on public.rides;
create trigger aa_skip_duplicate_ride
  before insert on public.rides
  for each row execute function public.skip_duplicate_ride();

-- Pas d'index à créer : idx_rides_user_created (user_id, created_at desc) existe
-- déjà depuis 20260425_security_hardening.sql et couvre exactement ce filtre.
