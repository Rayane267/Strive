-- ═══════════════════════════════════════════════════════════════════════════
-- TRANSFER depuis un compte supprimé : la révocation ne doit plus échouer
-- ═══════════════════════════════════════════════════════════════════════════
-- Un chauffeur supprime son compte, en recrée un, puis passe par le paywall :
-- RevenueCat transfère l'abonnement de l'ancien compte au nouveau. L'ancien
-- figure dans `transferred_from` mais n'existe plus dans `auth.users`, et
-- l'insertion dans `audit_log` — dont `user_id` référence `auth.users` — levait
-- `audit_log_user_id_fkey` (23503, constaté le 2026-10-14).
--
-- Sans effet ce jour-là : un compte supprimé n'a rien à révoquer. Mais
-- l'exception annule TOUTE la fonction : si le transfert part aussi d'un compte
-- vivant, celui-ci garde son tier — deux accès pour un seul paiement, ce que
-- cette fonction existe pour empêcher.
--
-- On ne journalise donc que les comptes qui existent encore. Garder l'id du
-- compte supprimé dans `details` irait contre `on delete set null`, qui efface
-- justement ce lien quand le compte disparaît.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.revoke_transferred_subscription(
  p_user_ids uuid[],
  p_event_id text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  -- Déduplication : RC rejoue les webhooks non acquittés.
  if p_event_id is not null then
    insert into public.processed_webhook_events (event_id, user_id, event_type)
    values (p_event_id, null, 'TRANSFER')
    on conflict (event_id) do nothing;
    if not found then
      raise notice 'Duplicate TRANSFER ignored: %', p_event_id;
      return 0;
    end if;
  end if;

  perform set_config('app.bypass_tier_check', 'on', true);

  -- L'abonnement appartient désormais à un autre compte : on coupe tout de
  -- suite plutôt que d'attendre l'expiration. Les crédits de scans achetés
  -- (extra_scan_credits) ne sont PAS repris : ce sont des consommables payés
  -- séparément, ils n'ont pas suivi le transfert de l'abonnement.
  update public.profiles
     set subscription_tier       = 'free',
         subscription_status     = 'expired',
         subscription_expires_at = least(coalesce(subscription_expires_at, now()), now())
   where id = any(p_user_ids)
     and coalesce(subscription_tier, 'free') <> 'free';

  get diagnostics v_count = row_count;

  insert into public.audit_log (user_id, action, details)
  select u, 'revenuecat_event',
         jsonb_build_object(
           'event_type', 'TRANSFER_REVOKED',
           'event_id',   p_event_id
         )
    from unnest(p_user_ids) as u
   where exists (select 1 from auth.users au where au.id = u);

  return v_count;
end;
$$;

revoke all on function public.revoke_transferred_subscription(uuid[], text) from public, anon, authenticated;
