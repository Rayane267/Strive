-- ═══════════════════════════════════════════════════════════════════════════
-- profiles : verrouille les colonnes qui décident d'un privilège
-- ═══════════════════════════════════════════════════════════════════════════
-- `profiles_update_own` (20260425_rls_policies.sql:43-47) autorise un
-- utilisateur à modifier SA ligne — et les policies RLS PostgreSQL n'ont pas de
-- granularité par colonne : c'est donc TOUTE la ligne. Le seul garde-fou est le
-- trigger `prevent_tier_tampering`, qui énumère les colonnes protégées une par
-- une. Trois colonnes décidant d'un privilège n'y figuraient pas.
--
-- 1. `is_admin` (ajoutée par 20260702_support_tickets.sql) — le plus grave.
--    Elle est l'unique fondement de `public.is_admin()`, qui contrôle à elle
--    seule l'accès inter-utilisateurs des policies `tickets_select`,
--    `tickets_update`, `messages_select` et `messages_insert`. Un simple
--      PATCH /rest/v1/profiles?id=eq.<son uid>  {"is_admin": true}
--    depuis n'importe quel compte chauffeur passait le `WITH CHECK` (la ligne
--    lui appartient) et le trigger (colonne non énumérée). L'auteur devenait
--    alors lecteur de TOUS les tickets de support — `user_email` et corps de
--    texte libre inclus, donc des données personnelles — et pouvait poster des
--    messages en `sender='staff'`, c'est-à-dire usurper le support Strive.
--
-- 2. `subscription_status` et `subscription_expires_at` — depuis
--    `20260702_subscription_audit_fixes.sql`, elles décident du tier EFFECTIF
--    dans `enforce_scan_quota`. Un abonné déchu dont le tier n'a pas encore été
--    remis à `free` (event EXPIRATION perdu ou retardé) pouvait écrire
--    `subscription_expires_at` dans le futur et conserver son quota payant
--    indéfiniment. `subscription_tier` était protégé, mais pas les deux
--    colonnes qui permettent de contourner sa lecture.
--
-- Les écrivains légitimes ne sont pas affectés : `apply_revenuecat_event`,
-- `revoke_transferred_subscription` et le traitement des remboursements posent
-- tous `app.bypass_tier_check` avant leurs UPDATE (bypass 1), et le service_role
-- passe par le bypass 2. Aucun code client n'écrit ces colonnes (vérifié sur
-- `src/` et `web/`). Le trigger est BEFORE UPDATE seulement : la création de
-- profil à l'inscription n'est pas concernée.
--
-- PAS de `revoke update (is_admin) … from authenticated` : ce serait un no-op
-- trompeur. `authenticated` tient son UPDATE des privilèges par défaut de
-- Supabase, accordés au niveau TABLE (aucun `grant` explicite sur `profiles`
-- dans les migrations). Or PostgreSQL n'autorise pas de retirer par colonne un
-- droit accordé sur la table entière : la commande passe avec un simple
-- warning « no privileges could be revoked » et ne protège rien. La seule
-- version efficace serait de révoquer l'UPDATE de la table puis de le
-- re-accorder colonne par colonne — au prix d'une liste exhaustive à maintenir,
-- qui casse silencieusement l'app à chaque nouvelle colonne. Le trigger est
-- donc le contrôle, et c'est pour ça que le test `is_admin` est placé avant les
-- bypass plutôt qu'après.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.prevent_tier_tampering()
returns trigger
language plpgsql
as $$
begin
  -- ATTENTION : `is_admin` est vérifié AVANT les bypass. Le bypass GUC est posé
  -- par des RPC qui n'ont aucune raison de toucher à ce drapeau ; le placer
  -- au-dessus évite qu'un futur chemin RPC serve d'échelle vers l'admin.
  if old.is_admin is distinct from new.is_admin then
    raise exception 'is_admin is read-only from client';
  end if;

  -- Bypass 1 : appelé par notre RPC SECURITY DEFINER
  if current_setting('app.bypass_tier_check', true) = 'on' then
    return new;
  end if;

  -- Bypass 2 : service_role (kept pour compat)
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
  if old.last_reset_date is distinct from new.last_reset_date then
    raise exception 'last_reset_date is read-only from client';
  end if;

  -- Ces deux-là décident du tier effectif dans enforce_scan_quota : les laisser
  -- ouvertes revenait à laisser `subscription_tier` ouvert.
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
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Connecté en tant qu'utilisateur normal (JWT authenticated), chacun doit
-- échouer :
--   update public.profiles set is_admin = true                where id = auth.uid();
--   update public.profiles set subscription_status = 'in_grace_period'
--                                                              where id = auth.uid();
--   update public.profiles set subscription_expires_at = now() + interval '1 year'
--                                                              where id = auth.uid();
--
-- Et celui-ci doit continuer de passer (colonne libre, écrite par l'app) :
--   update public.profiles set is_online = true                where id = auth.uid();
--
-- Enfin, vérifier qu'aucun compte n'a déjà été promu pendant la fenêtre
-- d'exposition — la colonne existe depuis 20260702 :
--   select id, email, is_admin from public.profiles where is_admin = true;
--   → ne doit rendre que TES comptes staff.
