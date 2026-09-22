-- ═══════════════════════════════════════════════════════════════════════════
-- Strive Plus : 20 scans par jour → illimité
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI. Premium est mis en suspens (`PREMIUM_ENABLED = false` côté app) :
-- Plus devient le seul palier vendu, à 8,99 €/mois, et reprend les scans
-- illimités de Premium. L'historique, lui, reste borné à 7 jours pour Plus
-- (`analyticsRangeDays`, côté app seulement).
--
-- `daily_scans = NULL` est la convention « illimité » de 20260517_plan_limits.sql,
-- déjà lue ainsi par `enforce_scan_quota` pour Premium.
--
-- EFFET SUR LES ABONNÉS EN COURS : immédiat au prochain scan (le trigger relit
-- la table). Aucun crédit n'est consommé par un Plus tant que la limite est NULL.
-- ═══════════════════════════════════════════════════════════════════════════

update public.plan_limits
   set daily_scans = null,
       updated_at  = now()
 where tier = 'plus';


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. select tier, daily_scans from plan_limits order by tier;
--    → free=3, plus=null, premium=null
--
-- 2. En tant que user plus, scanner plus de 20× dans la journée → aucun refus
--    `daily_scan_quota_exceeded`.
