-- ═══════════════════════════════════════════════════════════════════════════
-- rides.decided_at — distinguer une décision du chauffeur d'une clôture auto
-- ═══════════════════════════════════════════════════════════════════════════
-- LE PROBLÈME. `status` porte deux informations qui n'ont pas la même valeur :
--   • ACCEPTED / DECLINED tapés par le chauffeur → une décision, un signal ;
--   • DECLINED posé par la clôture hebdomadaire → un défaut, pas un signal.
-- Mélangés dans la même colonne, ils rendent faux tout taux d'acceptation et
-- toute mesure de « discipline » (qualityScore.ts, weeklyTease.ts). C'est
-- exactement ce qui a rendu inexploitable l'historique antérieur au 26/08.
--
-- LA RÉPONSE. Une colonne d'horodatage renseignée UNIQUEMENT quand le geste
-- vient du chauffeur. `decided_at is not null` devient le prédicat qui isole
-- les vraies décisions. `status` ne change pas de sémantique côté affichage :
-- l'Historique et le Dashboard continuent de lire ce qu'ils lisaient.
--
-- POURQUOI UN TRIGGER ET PAS UNE ÉCRITURE CLIENT. La policy `rides_update_own`
-- autorise un client à écrire n'importe quelle colonne de SES courses. Un
-- `decided_at` posé par l'app serait donc falsifiable, et la colonne censée
-- arbitrer entre décision et défaut deviendrait elle-même non fiable. Le
-- trigger la rend AUTORITAIRE CÔTÉ SERVEUR : quoi que le client envoie, seule
-- une vraie transition de statut l'écrit. Même principe que le quota — le
-- serveur tranche, le client n'est pas cru sur parole.
--
-- CONSÉQUENCE : AUCUN CHANGEMENT DE CODE CLIENT N'EST NÉCESSAIRE.
-- `ridesService.updateRideStatus` continue d'envoyer `{ status }` seul.
--
-- BACKFILL : AUCUN, VOLONTAIREMENT. Les courses existantes gardent
-- `decided_at = NULL`, y compris les ACCEPTED — dont on sait pourtant qu'elles
-- résultent d'un geste. Mettre `created_at` à la place inventerait une heure de
-- décision qui n'a jamais été enregistrée, et c'est précisément ce qu'on
-- cherche à ne plus faire. Les indicateurs de décision repartent donc de zéro
-- à partir de cette migration, sur de la donnée dont on connaît l'origine.
-- ═══════════════════════════════════════════════════════════════════════════


alter table public.rides
  add column if not exists decided_at timestamptz;

comment on column public.rides.decided_at is
  'Horodatage du geste du chauffeur (Prise / Refusee). NULL = aucune decision explicite : course encore en attente, ou cloturee automatiquement par close_pending_rides(). Ecrite uniquement par le trigger stamp_ride_decision.';


-- ─── Trigger : seule une vraie transition écrit la colonne ──────────────────
create or replace function public.stamp_ride_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Clôture automatique : on ne marque RIEN. C'est tout l'intérêt de la
  -- colonne — la course finit en DECLINED sans jamais avoir été décidée.
  -- Le drapeau est posé par close_pending_rides() en `is_local = true`, donc
  -- visible seulement dans sa transaction. Un client PostgREST ordinaire n'a
  -- aucun moyen de le poser (même mécanisme que `app.bypass_tier_check`).
  if coalesce(current_setting('app.auto_close_rides', true), '') = 'on' then
    new.decided_at := old.decided_at;
    return new;
  end if;

  -- Transition vers une décision : on horodate, quoi qu'ait envoyé le client.
  if new.status is distinct from old.status
     and new.status in ('ACCEPTED', 'DECLINED') then
    new.decided_at := now();
    return new;
  end if;

  -- Tout le reste (correction du tarif final, retour à PENDING, update sans
  -- changement de statut) : la colonne est immuable. Sans cette ligne, un
  -- client pourrait poser un `decided_at` arbitraire sur une course jamais
  -- tranchée, et le prédicat `decided_at is not null` ne vaudrait plus rien.
  new.decided_at := old.decided_at;
  return new;
end;
$$;

drop trigger if exists stamp_ride_decision on public.rides;
create trigger stamp_ride_decision
  before update on public.rides
  for each row
  execute function public.stamp_ride_decision();


-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENT S'EN SERVIR CÔTÉ ANALYSE
-- ═══════════════════════════════════════════════════════════════════════════
-- Vraies décisions seulement (le seul périmètre où un taux d'acceptation a
-- un sens) :
--   select status, count(*)
--   from public.rides
--   where decided_at is not null
--   group by status;
--
-- Délai entre le scan et la décision — mesure de la friction du tag :
--   select percentile_cont(0.5) within group (
--            order by extract(epoch from (decided_at - created_at)))
--   from public.rides where decided_at is not null;
--
-- Part des courses réellement tranchées (vs clôturées par défaut) :
--   select count(*) filter (where decided_at is not null)::float / count(*)
--   from public.rides where status <> 'PENDING';
--
-- ⚠️ Les écrans (qualityScore.ts, weeklyTease.ts, user_stats_today) n'ont PAS
-- été modifiés : ils continuent de compter tous les DECLINED. Les basculer sur
-- `decided_at is not null` les rendrait justes, mais viderait l'indicateur pour
-- tout l'historique existant — c'est un choix produit, pas une correction
-- technique, et il est laissé ouvert.
-- ═══════════════════════════════════════════════════════════════════════════
