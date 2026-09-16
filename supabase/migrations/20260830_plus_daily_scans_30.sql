-- ═══════════════════════════════════════════════════════════════════════════
-- Strive Plus : 15 → 30 scans par jour
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI. La carte Plus promet « une journée complète de service ». Une
-- journée de VTC, c'est 10 à 12 heures, 15 à 25 courses réalisées, et deux à
-- quatre fois plus d'offres regardées. Même en ne scannant que les courses où
-- il hésite, le chauffeur atteignait 15 — donc la promesse cassait précisément
-- sur le plan qui l'énonce, un samedi soir, au pire moment.
--
-- 30 sort de la zone atteignable sans devenir un chiffre décoratif : c'est un
-- scan toutes les 24 minutes sur douze heures. Aucun chauffeur honnête ne le
-- touche, et la borne continue d'exister — elle protège d'un client qui
-- boucherait sur le déclencheur screenshot, et elle laisse « illimité » vouloir
-- dire quelque chose le jour où Premium se vendra.
--
-- CE QUE ÇA NE CHANGE PAS : le coût. Un Plus qui saturerait ses 30 tous les
-- jours consomme ~2,20 € d'infrastructure par mois (TomTom pour l'essentiel,
-- Gemini est du bruit) sur 9,99 € encaissés. Le quota ne protège pas la
-- facture, il vend l'abonnement — et c'est pour ça qu'il peut bouger librement.
--
-- Le gratuit reste à 3 : assez pour voir l'app avoir raison, pas assez pour
-- travailler avec. Les 30 scans de bienvenue (20260830_welcome_credits.sql) se
-- chargent de faire vivre l'app sans rationnement les premiers jours.
-- ═══════════════════════════════════════════════════════════════════════════

update public.plan_limits
   set daily_scans = 30,
       updated_at  = now()
 where tier = 'plus';


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. La table dit 30 :
--    select tier, daily_scans from plan_limits order by tier;
--    → free=3, plus=30, premium=null
--
-- 2. L'app le reprend au prochain démarrage (fetchPlanLimits au boot, puis
--    cache mémoire). Le fallback JS de subscriptionService.ts a été aligné dans
--    le même commit : les deux disent 30 même si la table est injoignable.
--
-- 3. Quota effectif : en tant que user plus, scanner 31× → la 31e échoue
--    (`daily_scan_quota_exceeded`), sauf crédits restants.
