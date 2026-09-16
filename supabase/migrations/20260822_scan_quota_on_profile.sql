-- ═══════════════════════════════════════════════════════════════════════════
-- Le quota se compte sur un COMPTEUR, plus sur les courses
-- ═══════════════════════════════════════════════════════════════════════════
-- LE PROBLÈME. Le quota se comptait `select count(*) from rides` sur la journée
-- (20260811_quota_day_window_restore.sql). Or l'app expose « Supprimer mon
-- historique » (`AccountInfoScreen`), qui exécute `delete from rides where
-- user_id = …` — ce que la policy `rides_delete_own` autorise, et doit continuer
-- d'autoriser : le RGPD l'exige.
--
-- Le compteur de quota et les données supprimables étaient donc la même chose.
-- Trois scans, un appui sur le bouton, trois scans de plus. À l'infini, et
-- seulement pour les tiers limités — free et plus.
--
-- CE QU'ON UTILISE. `profiles.daily_scans_count` et `profiles.last_reset_date`
-- existent depuis l'origine, avec leur contrainte `>= 0`
-- (20260425_security_hardening.sql) et leur verrou client
-- (`prevent_tier_tampering`). Elles avaient été abandonnées au profit du
-- comptage sur `rides`. On les rebranche — sauf la date, remplacée ici par
-- `daily_scans_day` : la fenêtre de journée dépend du fuseau du chauffeur ET de
-- son `day_reset_hour` (0 h ou 4 h), ce qu'une `date` ne sait pas porter sans
-- ambiguïté. On stocke la borne elle-même.
--
-- POURQUOI PAS UNE TABLE D'ÉVÉNEMENTS. C'était la première réponse, et elle
-- était juste À L'ÉPOQUE : le journal natif REJOUE les scans qu'il n'a pas pu
-- insérer, parfois des heures plus tard, et un compteur s'incrémentait à chaque
-- passage. Il fallait donc une table dont la clé soit le scan lui-même pour
-- absorber les rejeux — avec son index unique, sa RLS, sa RPC d'affichage et sa
-- reprise de données.
--
-- Cette raison a disparu avec 20260821_ride_id_at_scan.sql : l'id est frappé au
-- scan, donc un rejeu N'INSÈRE RIEN. L'idempotence est acquise en amont, et le
-- compteur redevient suffisant.
--
-- LE POINT QUI REND ÇA POSSIBLE : AFTER, PAS BEFORE. Sur un
-- `insert … on conflict do nothing` qui part en conflit, PostgreSQL exécute
-- quand même les triggers BEFORE — un compteur placé là compterait les rejeux.
-- Les triggers AFTER ne se déclenchent que pour les lignes RÉELLEMENT insérées.
-- Et un AFTER peut lever, ce qui annule la transaction : il sait donc aussi
-- refuser. C'est tout le mécanisme.
--
-- CE QUE ÇA CORRIGE AU PASSAGE. Un scan qui n'aboutit pas à une course ne
-- consomme plus rien : ni l'échec d'analyse, ni le résultat que l'app écarte
-- (adresses incomplètes, valeurs aberrantes), ni l'insertion refusée par le
-- réseau. Le compteur ne bouge que sur une course réellement enregistrée.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists daily_scans_day timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- prevent_tier_tampering : `daily_scans_day` rejoint les colonnes verrouillées
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans ça, elle serait la faille : reculer la date d'un jour depuis le client
-- suffirait à faire repartir le compteur de zéro. Elle décide du quota au même
-- titre que `daily_scans_count`, elle est protégée pareil.
--
-- Recopie intégrale de 20260811_lock_privilege_columns.sql, une ligne en plus.
-- `is_admin` reste testé AVANT les bypass, pour la raison qui y est donnée.
create or replace function public.prevent_tier_tampering()
returns trigger
language plpgsql
as $$
begin
  if old.is_admin is distinct from new.is_admin then
    raise exception 'is_admin is read-only from client';
  end if;

  if current_setting('app.bypass_tier_check', true) = 'on' then
    return new;
  end if;

  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if old.subscription_tier is distinct from new.subscription_tier then
    raise exception 'subscription_tier is read-only from client';
  end if;
  if old.extra_scan_credits is distinct from new.extra_scan_credits then
    raise exception 'extra_scan_credits is read-only from client';
  end if;
  if old.daily_scans_count is distinct from new.daily_scans_count then
    raise exception 'daily_scans_count is read-only from client';
  end if;
  if old.daily_scans_day is distinct from new.daily_scans_day then
    raise exception 'daily_scans_day is read-only from client';
  end if;
  if old.last_reset_date is distinct from new.last_reset_date then
    raise exception 'last_reset_date is read-only from client';
  end if;

  if old.subscription_status is distinct from new.subscription_status then
    raise exception 'subscription_status is read-only from client';
  end if;
  if old.subscription_expires_at is distinct from new.subscription_expires_at then
    raise exception 'subscription_expires_at is read-only from client';
  end if;
  if old.subscription_product_id is distinct from new.subscription_product_id then
    raise exception 'subscription_product_id is read-only from client';
  end if;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- enforce_scan_quota : vérifie ET compte, en AFTER INSERT
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  daily_limit int;    -- NULL = illimité (premium)
  credits     int;
  used        int;
  stored_day  timestamptz;
  day_start   timestamptz;
begin
  -- Valeur de retour ignorée sur un AFTER : `null` partout, y compris sur les
  -- sorties anticipées.
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return null;
  end if;

  -- Fenêtre de jour : TZ du chauffeur + day_reset_hour. Doit rester alignée avec
  -- `getDayStart()` côté app et `currentQuotaDay()` côté natif.
  day_start := public.user_day_start(new.user_id);

  -- Une course datée d'une journée ÉCOULÉE ne consomme pas le quota du jour.
  -- C'est le cas du journal natif qui rejoue au matin un scan de la veille :
  -- `created_at` est dérivé de l'heure du scan, pas de celle de l'insertion.
  -- Le compter aujourd'hui bloquerait un chauffeur pour des courses d'hier.
  --
  -- ⚠️ Un client qui antidaterait `created_at` échapperait donc au quota. Le
  -- comptage sur `rides` avait exactement le même angle mort (`created_at >=
  -- day_start`) : ce n'est pas une régression, mais ce n'est pas fermé pour
  -- autant. La fermeture demanderait de tenir un compteur par journée.
  if new.created_at < day_start then
    return null;
  end if;

  -- Tier EFFECTIF : un abo expiré retombe en 'free' même si l'event EXPIRATION
  -- du webhook a été manqué — sauf pendant la période de grâce (miroir exact de
  -- getEffectivePlanTier / GRACE_PERIOD_DAYS).
  --
  -- FOR UPDATE : sérialise les scans concurrents du même chauffeur. Deux
  -- insertions simultanées au seuil liraient sinon le même compteur, et le
  -- quota serait dépassé d'une unité.
  select case
           when coalesce(subscription_tier, 'free') <> 'free'
                and subscription_expires_at is not null
                and subscription_expires_at < now()
                and not (
                  subscription_status = 'in_grace_period'
                  and subscription_expires_at > now() - interval '16 days'
                )
             then 'free'
           else coalesce(subscription_tier, 'free')
         end,
         coalesce(extra_scan_credits, 0),
         coalesce(daily_scans_count, 0),
         daily_scans_day
    into v_tier, credits, used, stored_day
    from public.profiles
    where id = new.user_id
    for update;

  select pl.daily_scans into daily_limit
    from public.plan_limits pl
    where pl.tier = v_tier;
  if not found then
    select pl.daily_scans into daily_limit
      from public.plan_limits pl
      where pl.tier = 'free';
  end if;

  -- Nouvelle journée de travail : le compteur repart de zéro. On le déduit de la
  -- borne stockée plutôt que d'une tâche planifiée — il n'y a rien à réveiller à
  -- minuit, et un chauffeur qui change de fuseau ou d'heure de reset bascule
  -- correctement au scan suivant.
  if stored_day is distinct from day_start then
    used := 0;
  end if;

  -- Le compteur est verrouillé côté client ; ce trigger est le seul à l'écrire.
  perform set_config('app.bypass_tier_check', 'on', true);

  -- Illimité : on compte quand même. Une rétrogradation vers free en cours de
  -- journée ne doit pas repartir d'un compteur vierge.
  if daily_limit is not null and used >= daily_limit then
    if credits <= 0 then
      raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
    end if;
    -- Au-delà de la limite avec des crédits : on en consomme un.
    update public.profiles
       set extra_scan_credits = credits - 1,
           daily_scans_count  = used + 1,
           daily_scans_day    = day_start
     where id = new.user_id;
    return null;
  end if;

  update public.profiles
     set daily_scans_count = used + 1,
         daily_scans_day   = day_start
   where id = new.user_id;

  return null;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Le trigger passe de BEFORE à AFTER
-- ═══════════════════════════════════════════════════════════════════════════
-- Même nom (`check_scan_quota`, 20260425_security_hardening.sql), autre moment.
-- C'est CE changement qui rend le comptage idempotent : un rejeu du journal
-- natif part en conflit sur la clé primaire, la ligne n'est pas insérée, et
-- l'AFTER ne se déclenche pas.
--
-- `check_account_age` (BEFORE INSERT, 20260425_email_anti_abuse.sql) n'est pas
-- touché : il refuse un premier scan trop précoce, il n'a rien à compter.
drop trigger if exists check_scan_quota on public.rides;
create trigger check_scan_quota
  after insert on public.rides
  for each row execute function public.enforce_scan_quota();

-- ═══════════════════════════════════════════════════════════════════════════
-- REPRISE DE L'EXISTANT
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans ça, tout le monde repart d'un compteur vierge au déploiement : une
-- journée de scans gratuits offerte au parc entier. On initialise depuis les
-- courses du jour, c'est-à-dire exactement ce que l'ancien trigger comptait.
--
-- `set_config` en portée SESSION (`false`) et non transaction : une migration
-- n'est pas garantie de tourner dans une transaction unique selon l'outil qui
-- l'applique. Remis à 'off' juste après.
select set_config('app.bypass_tier_check', 'on', false);

update public.profiles p
   set daily_scans_count = coalesce((
         select count(*)
           from public.rides r
          where r.user_id = p.id
            and r.created_at >= public.user_day_start(p.id)
       ), 0),
       daily_scans_day = public.user_day_start(p.id);

-- Si 20260820 a tourné en production, son registre a compté des scans que
-- `rides` ne montre plus — c'est précisément le trou qu'il fermait, et un
-- chauffeur ayant supprimé son historique aujourd'hui repartirait sinon à zéro
-- en repassant par la reprise ci-dessus. On prend donc le plus grand des deux.
--
-- Bloc dynamique et pas une requête directe : la table est supprimée à la fin de
-- ce fichier, et cette migration doit rester rejouable.
do $$
begin
  if to_regclass('public.scan_ledger') is not null then
    execute $q$
      update public.profiles p
         set daily_scans_count = greatest(
               coalesce(p.daily_scans_count, 0),
               coalesce((
                 select count(*)
                   from public.scan_ledger l
                  where l.user_id = p.id
                    and l.created_at >= public.user_day_start(p.id)
               ), 0)
             )
    $q$;
  end if;
end $$;

select set_config('app.bypass_tier_check', 'off', false);

-- ═══════════════════════════════════════════════════════════════════════════
-- Dépose de 20260820 : le registre n'a plus d'écrivain
-- ═══════════════════════════════════════════════════════════════════════════
-- `enforce_scan_quota()` vient d'être redéfinie ci-dessus et n'écrit plus dans
-- `scan_ledger`. Laisser la table et sa RPC en place serait pire que de les
-- supprimer : `quota_remaining_scans()` est `granted to authenticated`, elle
-- compte un registre désormais figé, et répondrait donc `used = 0` — c'est-à-dire
-- le quota entier disponible — à qui l'appellerait. Une fonction qui ment est un
-- piège pour le prochain qui la trouvera.
--
-- La reprise juste au-dessus a récupéré ce que le registre savait ; il ne porte
-- plus d'information que le compteur n'ait pas.
drop function if exists public.quota_remaining_scans();
-- Emporte la policy `scan_ledger_select_own` et les deux index avec elle.
drop table if exists public.scan_ledger;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Le trou est fermé. En tant que chauffeur free ayant consommé ses 3 scans :
--      delete from rides where user_id = auth.uid();
--    puis tenter une insertion → doit toujours lever P0001.
--
-- 2. Un rejeu ne compte pas. Insérer deux fois le même id :
--      insert into rides (id, user_id, …) values ('1111…', auth.uid(), …)
--      on conflict (id) do nothing;
--    → `daily_scans_count` ne doit avoir bougé que d'une unité.
--
-- 3. Une course d'hier ne consomme pas aujourd'hui : insérer avec
--    `created_at = now() - interval '2 days'` → compteur inchangé.
--
-- 4. Le reset tient sans tâche planifiée : forcer
--      update profiles set daily_scans_day = now() - interval '2 days' …
--    (en service_role) puis insérer → le compteur doit retomber à 1.
--
-- 5. Concurrence : deux insertions simultanées d'un free au seuil → une seule
--    passe, l'autre lève P0001.
--
-- 6. Le client ne peut pas tricher :
--      update profiles set daily_scans_day = now() - interval '1 day'
--       where id = auth.uid();
--    → doit lever 'daily_scans_day is read-only from client'.
--
-- 7. Le registre de 20260820 n'a rien laissé derrière lui :
--      select to_regclass('public.scan_ledger');            -- => NULL
--      select proname from pg_proc
--       where proname = 'quota_remaining_scans';            -- => 0 ligne
--    Et le compteur a bien repris ce qu'il savait : pour un chauffeur ayant
--    supprimé son historique aujourd'hui, `daily_scans_count` doit valoir le
--    nombre de scans du registre, pas 0.
