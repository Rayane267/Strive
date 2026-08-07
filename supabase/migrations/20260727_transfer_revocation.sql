-- ═══════════════════════════════════════════════════════════════════════════
-- TRANSFER : révocation de l'ancien porteur
-- ═══════════════════════════════════════════════════════════════════════════
-- RevenueCat émet TRANSFER quand un même reçu Apple passe d'un App User ID à un
-- autre — restauration depuis un second compte Strive, ou achat effectué hors de
-- l'app (« achat simplifié ») puis rattaché au compte qui ouvre l'app.
--
-- L'event ne porte ni app_user_id, ni product_id, ni date d'expiration : il ne
-- transporte que les listes transferred_from / transferred_to. On ne peut donc
-- pas ACCORDER un accès sur sa seule foi. En revanche on peut, et on doit,
-- RETIRER celui de l'ancien porteur : sans ça il conserve son tier jusqu'à sa
-- date d'expiration, soit deux accès actifs pour un seul paiement.
--
-- L'octroi au nouveau porteur est traité par l'edge function, qui interroge
-- l'API RevenueCat pour connaître l'état réel de l'abonnement (produit +
-- expiration) et repasse par apply_revenuecat_event.
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
    from unnest(p_user_ids) as u;

  return v_count;
end;
$$;

revoke all on function public.revoke_transferred_subscription(uuid[], text) from public, anon, authenticated;
