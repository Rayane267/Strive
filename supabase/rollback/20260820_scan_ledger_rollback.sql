-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ SANS OBJET SI 20260822 EST APPLIQUÉ
-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822_scan_quota_on_profile.sql supprime `scan_ledger` et
-- `quota_remaining_scans()`, et redéfinit `enforce_scan_quota` sur le compteur
-- de `profiles`. Il n'y a alors plus rien ici à annuler : le rollback à jouer
-- est celui de 20260822.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 20260820_scan_ledger.sql — retour à l'état du commit effe042
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ CE FICHIER N'EST PAS UNE MIGRATION. Il vit hors de `supabase/migrations/`
-- exprès : posé là-bas, il serait rejoué au prochain `db push` et annulerait le
-- registre sans que personne ne l'ait demandé. À exécuter à la main, une fois,
-- dans l'éditeur SQL.
--
-- CE QU'IL REND :
--   • `enforce_scan_quota` recompte les COURSES du jour (version de
--     20260811_quota_day_window_restore.sql)
--   • `quota_remaining_scans()` disparaît
--   • `scan_ledger` reste en place mais n'est plus alimentée ni lue
--
-- CE QU'IL ROUVRE, et c'est le prix à payer : supprimer son historique rend de
-- nouveau des scans, indéfiniment. C'était la raison d'être du registre.
--
-- CÔTÉ APP : aucun build n'appelle `quota_remaining_scans()` — l'écran a
-- toujours lu soit les courses du jour, soit `profiles.daily_scans_count`. Le
-- retrait de la fonction est donc sans effet sur les appareils déployés.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Le trigger, d'abord ────────────────────────────────────────────────
-- Avant de retirer quoi que ce soit : tant que cette fonction lit `scan_ledger`,
-- la table ne peut pas être touchée sans casser les insertions de courses.
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  daily_limit int;    -- NULL = illimité (premium)
  count_today int;
  credits     int;
  day_start   timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

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
         coalesce(extra_scan_credits, 0)
    into v_tier, credits
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

  if daily_limit is null then
    return new;
  end if;

  day_start := public.user_day_start(new.user_id);

  select count(*) into count_today
    from public.rides
    where user_id = new.user_id
      and created_at >= day_start;

  if count_today >= daily_limit and credits <= 0 then
    raise exception 'daily_scan_quota_exceeded' using errcode = 'P0001';
  end if;

  if count_today >= daily_limit and credits > 0 then
    perform set_config('app.bypass_tier_check', 'on', true);
    update public.profiles
      set extra_scan_credits = extra_scan_credits - 1
      where id = new.user_id;
  end if;

  return new;
end;
$$;

-- ── 2. La RPC ─────────────────────────────────────────────────────────────
drop function if exists public.quota_remaining_scans();

-- ── 3. La table : CONSERVÉE ───────────────────────────────────────────────
-- Volontairement pas supprimée. Elle ne coûte rien une fois que plus personne ne
-- l'alimente, et la détruire effacerait l'historique des scans consommés — donc
-- toute possibilité de revenir en arrière sur ce rollback.
--
-- Si vous voulez vraiment la faire disparaître, décommentez. Irréversible :
--
--   drop table if exists public.scan_ledger;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Le rollback a déjà échoué silencieusement une fois dans ce projet. Ne vous
-- fiez pas au « Success » de l'éditeur : testez.
--
--   insert into public.rides
--     (user_id, platform, status, fare_estimated, distance_km, duration_min,
--      hourly_rate, km_rate, scan_ts)
--   values
--     ('<uid>', 'UBER', 'PENDING', 20, 10, 30, 40, 2, extract(epoch from now()));
--
-- • Passe, ou refuse au-delà du quota → l'ancienne version est active.
-- • Le message cite `scan_ledger` → le rollback n'a pas pris.
--
-- Et pensez à supprimer la ligne de test, sinon elle compte dans le quota :
--   delete from public.rides where scan_ts = <celui de l insert>;
--
-- Le compteur repart à zéro en supprimant les courses du jour — ce qui
-- redevient possible, puisque c'est précisément ce que le registre empêchait :
--   delete from public.rides
--    where user_id = '<uid>' and created_at >= public.user_day_start('<uid>');
-- ═══════════════════════════════════════════════════════════════════════════
