-- ═══════════════════════════════════════════════════════════════════════════
-- Clôture automatique des sessions sans scan depuis 2 h
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI CLOCHAIT. La coupure existe déjà côté app — un intervalle de 5 min sur
-- le Dashboard, plus un rattrapage à la réouverture (« Sécurité session oubliée »).
-- Les deux ont le même angle mort : ils ne tournent QUE si l'app tourne. Un
-- chauffeur qui passe en ligne puis tue l'app laisse une session ouverte jusqu'à
-- sa prochaine ouverture — parfois le lendemain.
--
-- Ce n'est pas cosmétique : `online_sessions.duration_seconds` est le
-- dénominateur du €/h. Une session de 20 minutes restée ouverte 14 heures ne
-- rend pas le chiffre approximatif, elle le rend faux d'un facteur 40, et le
-- chauffeur n'a aucun moyen de deviner pourquoi ses statistiques se sont
-- effondrées.
--
-- CE QU'ON NE REMPLACE PAS. La coupure côté app reste : elle est immédiate, elle
-- notifie, et elle arrête le scanner natif (bulle Android / raccourci iOS). Ce
-- job est le filet, pas le mécanisme principal — il rattrape ce que l'app
-- endormie ne peut pas faire.

-- ═══════════════════════════════════════════════════════════════════════════
-- Les deux bornes — À GARDER ÉGALES À DashboardScreen.tsx
-- ═══════════════════════════════════════════════════════════════════════════
--   SESSION_INACTIVITY_MS = 2 * 3600_000   → 2 heures sans course scannée
--   SESSION_MAX_MS        = 14 * 3600_000  → durée maximale d'une session
--
-- Écrites en dur ici comme elles le sont là-bas. Un écart entre les deux ferait
-- couper le serveur là où l'app tient encore la session ouverte : le chauffeur
-- verrait sa session tomber sans raison visible, puis repartir au scan suivant.
create or replace function public.close_stale_sessions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inactivity constant interval := interval '2 hours';
  v_max        constant interval := interval '14 hours';
  v_closed     int := 0;
begin
  with open_sessions as (
    select s.id, s.user_id, s.start_at
      from public.online_sessions s
     where s.end_at is null
     -- Rien à décider avant que l'une des deux bornes soit seulement
     -- atteignable : sans ce filtre le job relirait toutes les sessions ouvertes
     -- du parc à chaque passage, pour n'en fermer aucune.
       and s.start_at < now() - least(v_inactivity, v_max)
     for update skip locked
  ),
  -- Dernière activité RÉELLE : la course la plus récente de la session. Et non
  -- `updated_at` ou un battement de présence — une app au premier plan qui ne
  -- scanne rien n'est pas une session de travail, c'est justement ce qu'on veut
  -- fermer. `start_at` sert de plancher pour une session sans aucun scan.
  activity as (
    select o.id,
           o.user_id,
           o.start_at,
           coalesce(max(r.created_at), o.start_at) as last_at
      from open_sessions o
      left join public.rides r
        on r.user_id = o.user_id
       and r.created_at >= o.start_at
     group by o.id, o.user_id, o.start_at
  ),
  stale as (
    select id,
           user_id,
           start_at,
           -- On clôture à la dernière activité, jamais à `now()` : le temps mort
           -- entre le dernier scan et le passage du job n'a pas été travaillé et
           -- ne doit pas gonfler le dénominateur du €/h. Le plafond borne le cas
           -- de la session sans scan partie depuis plus de 14 h.
           least(last_at, start_at + v_max) as end_at
      from activity
     where now() - last_at   > v_inactivity
        or now() - start_at  > v_max
  ),
  closed as (
    update public.online_sessions s
       set end_at = st.end_at,
           -- `greatest(..., 0)` : `last_at` ne peut pas précéder `start_at` (le
           -- coalesce le garantit), mais une horloge client qui a daté une course
           -- avant le début de sa propre session suffirait à écrire une durée
           -- négative, que plus rien ne corrigerait ensuite.
           duration_seconds = greatest(0, floor(extract(epoch from (st.end_at - s.start_at)))::int)
      from stale st
     where s.id = st.id
    returning s.user_id
  ),
  -- Le drapeau suit la session. Sans ça le chauffeur reste « en ligne » aux yeux
  -- de la console admin et de l'app, sur une session que le job vient de fermer.
  flagged as (
    update public.profiles p
       set is_online = false
      from closed c
     where p.id = c.user_id
       and p.is_online
    returning 1
  )
  select count(*) into v_closed from closed;

  return v_closed;
end;
$$;

revoke execute on function public.close_stale_sessions() from public;


-- ═══════════════════════════════════════════════════════════════════════════
-- Planification
-- ═══════════════════════════════════════════════════════════════════════════
-- Toutes les 15 minutes. La borne est à 2 h : un quart d'heure de retard sur une
-- fenêtre de deux heures est invisible dans les statistiques, et c'est quinze
-- fois moins de passages qu'un job à la minute pour le même résultat.
--
-- L'app, elle, vérifie toutes les 5 minutes quand elle tourne — c'est elle qui
-- donne la coupure ressentie comme immédiate.
do $$
begin
  perform cron.unschedule('close-stale-sessions');
exception when others then
  null;   -- le job n'existait pas encore
end $$;

select cron.schedule(
  'close-stale-sessions',
  '*/15 * * * *',
  $$ select public.close_stale_sessions() $$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Job planifié :
--   select jobname, schedule, command from cron.job where jobname = 'close-stale-sessions';
--
-- Passage manuel (rend le nombre de sessions fermées) :
--   select public.close_stale_sessions();
--
-- Sessions encore ouvertes et leur inactivité :
--   select s.id, s.user_id, s.start_at,
--          now() - coalesce(max(r.created_at), s.start_at) as inactive_for
--     from public.online_sessions s
--     left join public.rides r
--       on r.user_id = s.user_id and r.created_at >= s.start_at
--    where s.end_at is null
--    group by s.id, s.user_id, s.start_at
--    order by inactive_for desc;
--
-- Derniers passages :
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobname = 'close-stale-sessions'
--    order by start_time desc limit 10;
--
-- Aucune durée négative ne doit exister :
--   select count(*) from public.online_sessions where duration_seconds < 0;   → 0
