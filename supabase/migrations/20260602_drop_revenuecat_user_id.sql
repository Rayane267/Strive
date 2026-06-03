-- ═══════════════════════════════════════════════════════════════════════════
-- Retire profiles.revenuecat_user_id (+ son index).
-- ═══════════════════════════════════════════════════════════════════════════
-- Colonne jamais écrite (ni l'app ni le webhook ne la renseignaient) et
-- redondante : RevenueCat utilise déjà profiles.id comme app_user_id (via
-- Purchases.logIn). Le mapping achat → utilisateur passe par cet UUID, pas par
-- cette colonne. On la supprime pour ne pas laisser un champ mort dans le schéma.
--
-- NB : on ne touche PAS à l'intégration RevenueCat elle-même (webhook, tier,
-- entitlements) qui reste indispensable aux abonnements.

drop index if exists idx_profiles_revenuecat_user;
alter table public.profiles drop column if exists revenuecat_user_id;
