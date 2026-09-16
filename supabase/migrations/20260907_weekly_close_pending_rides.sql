-- ═══════════════════════════════════════════════════════════════════════════
-- Clôture hebdomadaire des courses non tranchées
-- ═══════════════════════════════════════════════════════════════════════════
-- RÈGLE MÉTIER. Une course scannée reste « en attente » tant que le chauffeur
-- n'a pas tapé « Prise » ou « Refusée ». Elle ne peut pas le rester
-- indéfiniment : au bout d'une semaine, l'absence de décision vaut refus.
--   1. Clôture hebdomadaire : dimanche 23h59, HEURE LOCALE DU CHAUFFEUR.
--   2. Filet de sécurité : plus aucune course ne dépasse 7 jours en attente,
--      même si la clôture du dimanche a été manquée (cron indisponible,
--      chauffeur ayant changé de fuseau, compte créé entre deux passages).
--
-- CE QUE CETTE MIGRATION RÉINTRODUIT VOLONTAIREMENT. Un statut par défaut :
-- une course passe en DECLINED sans que le chauffeur ait rien tapé. C'est
-- exactement le mécanisme retiré le 26/08 (commit 6887706), qui basculait les
-- courses de la veille au premier chargement du lendemain. La différence est la
-- fenêtre — un jour contre une semaine — et elle est décisive côté produit :
-- 24h ne laissent pas le temps de taguer une soirée de travail, 7 jours si.
--
-- ⚠️ CONSÉQUENCE ANALYTIQUE, À CONNAÎTRE AVANT D'EXPLOITER `rides.status`.
-- Après cette migration, DECLINED redevient un statut AMBIGU : il recouvre
-- « le chauffeur a refusé » ET « le chauffeur n'a rien dit pendant 7 jours ».
-- Tout indicateur d'acceptation, de refus ou de discipline (qualityScore.ts,
-- weeklyTease.ts, user_stats_today) mélange donc décision et défaut.
--
-- C'est pourquoi la migration jumelle `20260907_ride_decided_at.sql` ajoute une
-- colonne `decided_at`, horodatée UNIQUEMENT par le geste du chauffeur et
-- laissée à NULL par cette clôture. `decided_at is not null` distingue alors
-- une vraie décision d'une clôture automatique, sans changer `status` ni casser
-- l'affichage existant. Les deux migrations vont ensemble : appliquer celle-ci
-- seule remettrait de l'ambiguïté dans `status` sans le moyen de la lever.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── Fonction de clôture ────────────────────────────────────────────────────
-- Retourne le nombre de courses clôturées (utile pour lire cron.job_run_details).
--
-- Idempotente par construction : une course clôturée n'est plus PENDING, donc
-- un second passage dans la même heure ne trouve rien à faire.
--
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire, donc au-dessus
-- de la RLS de `rides` — le job cron n'a pas d'utilisateur authentifié.
create or replace function public.close_pending_rides()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_total int := 0;
  n            int;
begin
  -- Drapeau lu par le trigger `stamp_ride_decision` (20260907_ride_decided_at) :
  -- il lui dit que les UPDATE qui suivent ne sont PAS des décisions de chauffeur
  -- et qu'il ne doit donc rien horodater. `is_local = true` → visible seulement
  -- dans cette transaction, inatteignable depuis un client PostgREST. Même
  -- mécanisme que `app.bypass_tier_check`.
  perform set_config('app.auto_close_rides', 'on', true);

  -- ── 1. Clôture hebdomadaire, dimanche 23h59 locale ────────────────────────
  -- La fonction est appelée toutes les heures à HH:59 ; elle ne fait quelque
  -- chose que pour les chauffeurs chez qui il est justement dimanche 23h59. Un
  -- chauffeur à Fort-de-France et un chauffeur à Paris sont donc clôturés à cinq
  -- heures d'intervalle, chacun à la fin de SA semaine.
  --
  -- Le `created_at <` borne la clôture au début de cette heure-là (23h00 local) :
  -- une course scannée dimanche 23h30 n'est pas balayée vingt-neuf minutes plus
  -- tard, elle démarre la semaine suivante. Sans cette borne, un scan de fin de
  -- soirée aurait une espérance de vie de quelques minutes.
  with sweeping as (
    select p.id                                    as uid,
           coalesce(p.timezone, 'Europe/Paris')    as tz
    from public.profiles p
    where extract(dow  from (now() at time zone coalesce(p.timezone, 'Europe/Paris'))) = 0
      and extract(hour from (now() at time zone coalesce(p.timezone, 'Europe/Paris'))) = 23
  )
  update public.rides r
     set status = 'DECLINED'
    from sweeping s
   where r.user_id = s.uid
     and r.status  = 'PENDING'
     and r.created_at < (
           date_trunc('hour', now() at time zone s.tz) at time zone s.tz
         );
  get diagnostics n = row_count;
  closed_total := closed_total + n;

  -- ── 2. Filet de sécurité : plafond dur à 7 jours ──────────────────────────
  -- Indépendant du fuseau et du jour de la semaine. Couvre les trous du cron et
  -- les comptes dont le fuseau a changé entre deux dimanches. En régime normal
  -- il ne trouve rien : la clôture du dimanche est passée avant.
  update public.rides
     set status = 'DECLINED'
   where status = 'PENDING'
     and created_at < now() - interval '7 days';
  get diagnostics n = row_count;
  closed_total := closed_total + n;

  return closed_total;
end;
$$;

comment on function public.close_pending_rides() is
  'Clot les courses non tranchees : dimanche 23h59 locale, plus un plafond dur a 7 jours. Appelee toutes les heures par pg_cron.';

-- Aucun GRANT à un rôle client : la fonction n'est appelable que par le cron
-- (postgres) et le service_role. Un chauffeur ne doit pas pouvoir déclencher la
-- clôture des courses de tout le parc.
revoke all on function public.close_pending_rides() from public, anon, authenticated;


-- ─── Planification horaire ──────────────────────────────────────────────────
-- Horaire et non hebdomadaire : c'est ce qui permet de respecter le fuseau de
-- chaque chauffeur avec un seul job (cf. commentaire du bloc 1). Le coût est
-- négligeable — 24 passages/jour sur un UPDATE indexé qui ne trouve rien la
-- plupart du temps.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('close-pending-rides');
exception when others then
  null;   -- le job n'existait pas encore
end $$;

select cron.schedule(
  'close-pending-rides',
  '59 * * * *',                      -- à HH:59 : c'est ce qui place la clôture à 23h59 locale
  $$ select public.close_pending_rides() $$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Job planifié :
--   select jobname, schedule, command from cron.job where jobname = 'close-pending-rides';
--
-- Derniers passages et nombre de courses cloturees :
--   select start_time, status, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'close-pending-rides')
--   order by start_time desc limit 10;
--
-- Simulation a blanc (ne modifie rien) — qui serait balaye maintenant :
--   select r.user_id, count(*)
--   from public.rides r
--   join public.profiles p on p.id = r.user_id
--   where r.status = 'PENDING'
--     and (   r.created_at < now() - interval '7 days'
--          or (extract(dow  from (now() at time zone coalesce(p.timezone,'Europe/Paris'))) = 0
--          and extract(hour from (now() at time zone coalesce(p.timezone,'Europe/Paris'))) = 23))
--   group by 1;
--
-- Execution manuelle (rattrapage) :
--   select public.close_pending_rides();
-- ═══════════════════════════════════════════════════════════════════════════
