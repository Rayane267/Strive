-- ═══════════════════════════════════════════════════════════════════════════
-- Strive Plus : 30 → 20 scans par jour
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI. 30 (20260830_plus_daily_scans_30.sql) avait été choisi pour sortir
-- de la zone atteignable — au point de ne plus rien vouloir dire. Une borne que
-- personne ne touche ne vend pas l'abonnement : elle disparaît de la carte
-- Plus. 20 reste au-dessus de la journée réelle (10–12 h, 15 à 25 courses, un
-- scan seulement sur les offres où le chauffeur hésite) tout en restant un
-- chiffre qu'on lit comme une promesse et non comme un remplissage.
--
-- CE QUE ÇA NE CHANGE PAS : le coût — il n'a jamais été le sujet, un Plus qui
-- saturait ses 30 coûtait ~2,20 € d'infra sur 9,99 € encaissés. Le gratuit
-- reste à 3, les 30 crédits de bienvenue (20260830_welcome_credits.sql) restent
-- à 30 : ils font vivre l'app sans rationnement les premiers jours, et ils sont
-- indépendants du quota journalier.
--
-- EFFET SUR LES ABONNÉS EN COURS : immédiat au prochain scan (le trigger relit
-- la table). Un Plus déjà au-delà de 20 aujourd'hui bascule sur ses crédits
-- (`extra_scan_credits`, puis crédits de bienvenue) comme n'importe quel
-- dépassement de quota — aucun scan déjà enregistré n'est remis en cause.
-- ═══════════════════════════════════════════════════════════════════════════

update public.plan_limits
   set daily_scans = 20,
       updated_at  = now()
 where tier = 'plus';


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. La table dit 20 :
--    select tier, daily_scans from plan_limits order by tier;
--    → free=3, plus=20, premium=null
--
-- 2. L'app le reprend au prochain démarrage (fetchPlanLimits au boot, puis
--    cache mémoire). Le fallback JS de subscriptionService.ts a été aligné dans
--    le même commit : les deux disent 20 même si la table est injoignable.
--
-- 3. Quota effectif : en tant que user plus, scanner 21× → la 21e échoue
--    (`daily_scan_quota_exceeded`), sauf crédits restants.
