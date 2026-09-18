-- ═══════════════════════════════════════════════════════════════════════════
-- prevent_tier_tampering : la garde ne doit viser que les CLIENTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI CLOCHAIT. La garde ne connaissait qu'une porte de sortie : le claim
-- JWT `request.jwt.claim.role = 'service_role'`, c'est-à-dire le webhook
-- RevenueCat. Or ce claim n'existe QUE dans une requête passée par PostgREST.
--
-- Une commande lancée depuis l'éditeur SQL du tableau de bord n'en porte aucun.
-- Le propriétaire du projet était donc traité comme un fraudeur :
--
--     ERROR: P0001: subscription_tier is read-only from client
--     CONTEXT: PL/pgSQL function prevent_tier_tampering() line 16
--
-- Conséquence concrète : impossible de corriger à la main un abonnement qu'un
-- webhook a mal appliqué, de préparer un compte de démonstration pour la revue
-- App Store, ou de dépanner un chauffeur qui a payé et n'a rien reçu — sauf à
-- se déguiser en `service_role` par un `set_config` dans une transaction, ou à
-- désactiver le trigger, c'est-à-dire à débrancher la protection en production
-- en espérant ne pas oublier de la remettre.
--
-- CE QUE LA GARDE PROTÈGE VRAIMENT. Elle existe pour qu'un chauffeur ne
-- s'octroie pas Premium en écrivant dans son propre profil depuis l'app. Cette
-- écriture-là arrive TOUJOURS par PostgREST, sous l'un des rôles `authenticated`
-- ou `anon` (PostgREST se connecte en `authenticator` puis bascule). Aucun
-- client ne peut être `postgres` : la connexion directe n'est pas exposée.
--
-- Le critère juste n'est donc pas « porte-t-il le bon claim ? » mais « est-ce
-- une requête de CLIENT ? ». On inverse : la garde s'applique aux rôles de
-- l'API, et laisse passer tout le reste — l'éditeur SQL, psql, une migration,
-- pg_cron. Le service_role reste nommé explicitement : il passe par PostgREST
-- comme les autres, son rôle SQL est `service_role` et il lui faut sa porte.
--
-- La protection ne perd rien : ce qu'elle bloquait hier, elle le bloque encore,
-- au caractère près. Elle cesse seulement de bloquer ceux qui n'ont jamais été
-- sa cible.

create or replace function public.prevent_tier_tampering()
returns trigger
language plpgsql
as $$
begin
  -- Sortie 1 — le webhook RevenueCat, qui passe par PostgREST avec le claim.
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  -- Sortie 2 — tout ce qui n'est pas une requête de client. L'éditeur SQL, une
  -- migration, pg_cron, psql : aucun de ces chemins n'est exposé à un chauffeur,
  -- et tous ont de bonnes raisons de corriger un abonnement.
  if current_user not in ('authenticated', 'anon', 'authenticator') then
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
  if old.last_reset_date is distinct from new.last_reset_date then
    raise exception 'last_reset_date is read-only from client';
  end if;

  return new;
end;
$$;

-- Le trigger lui-même ne change pas ; `create or replace function` suffit.


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Depuis l'éditeur SQL, l'écriture passe (c'était le but) :
--      update public.profiles
--         set subscription_tier       = 'premium',
--             subscription_status     = 'active',
--             subscription_expires_at = now() + interval '1 year'
--       where id = '<uuid>';
--      → UPDATE 1
--
--    ⚠️ `subscription_expires_at` DOIT être dans le futur : `enforce_scan_quota`
--    rétrograde en gratuit tout palier expiré. Un profil marqué « premium » avec
--    une date passée se comporte comme un compte gratuit.
--
-- 2. La garde tient toujours contre un client. Depuis l'app, ou en simulant :
--      begin;
--      set local role authenticated;
--      update public.profiles set subscription_tier = 'premium' where id = auth.uid();
--      → ERROR: subscription_tier is read-only from client
--      rollback;
--
-- 3. Et le webhook continue de passer :
--      begin;
--      select set_config('request.jwt.claim.role', 'service_role', true);
--      set local role authenticated;
--      update public.profiles set subscription_tier = 'plus' where id = '<uuid>';
--      → UPDATE 1
--      rollback;
