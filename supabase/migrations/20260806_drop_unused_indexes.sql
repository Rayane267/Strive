-- ═══════════════════════════════════════════════════════════════════════════
-- Suppression des index jamais utilisés
-- ═══════════════════════════════════════════════════════════════════════════
-- Constat mesuré sur l'instance de production : `idx_scan = 0` pour chacun de
-- ces index, sur une fenêtre de statistiques de 83 jours (uptime continu,
-- `pg_stat_database.stats_reset` à null → aucun compteur remis à zéro). Le
-- verdict porte donc sur une période représentative, pas sur un redémarrage
-- récent qui aurait effacé l'historique.
--
-- Un index jamais lu n'est pas neutre : il est maintenu à CHAQUE insert et
-- update de la table, et occupe de l'espace. Sur `rides` — 2 531 inserts et
-- 2 436 updates — c'est un coût payé à chaque course pour zéro lecture.
--
-- ⚠️ `idx_profiles_email_normalized_unique` est VOLONTAIREMENT ÉPARGNÉ. Il
-- affiche lui aussi `idx_scan = 0`, mais c'est un index UNIQUE : ce compteur ne
-- mesure que les lectures, alors que l'index est vérifié à chaque écriture et
-- porte la garantie d'unicité des emails. Le supprimer parce qu'il « n'est
-- jamais lu » casserait une contrainte d'intégrité — c'est exactement le piège
-- d'un nettoyage automatisé d'index.
--
-- Réversible : chaque index est recréé par la migration qui l'a introduit.
-- ═══════════════════════════════════════════════════════════════════════════

-- Table la plus écrite du schéma — c'est ici que le gain est réel (232 Ko).
drop index if exists public.rides_user_created_at_idx;

-- Télémétrie : seul l'index (created_at desc) sert réellement aux agrégats.
drop index if exists public.idx_scan_events_platform_created;

-- Tables à faible volume : index posés par anticipation, jamais sollicités.
drop index if exists public.idx_processed_webhook_events_created;
drop index if exists public.idx_vehicles_model;

-- Fonctionnalité support livrée mais inutilisée (0 ligne dans les deux tables).
drop index if exists public.idx_support_tickets_user;
drop index if exists public.idx_support_tickets_status;
drop index if exists public.idx_support_messages_ticket;

-- scan_debug n'a jamais reçu une ligne : la capture ne se déclenche pas sur iOS
-- (le payload natif n'inclut pas `debugBlocks`). À recréer le jour où la
-- capture fonctionnera vraiment et où la table se remplira.
drop index if exists public.idx_scan_debug_created;
drop index if exists public.idx_scan_debug_dest_missing;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Doit renvoyer la seule ligne `idx_profiles_email_normalized_unique` :
--   select indexrelname, idx_scan
--     from pg_stat_user_indexes
--     where schemaname = 'public' and idx_scan = 0
--     order by 1;
