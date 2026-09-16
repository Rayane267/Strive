-- ═══════════════════════════════════════════════════════════════════════════
-- Strive — diagnostic scanner
-- ═══════════════════════════════════════════════════════════════════════════
-- Usage :
--   export STRIVE_DB_URL='postgresql://…'   # variable de session, JAMAIS un fichier du repo
--   psql "$STRIVE_DB_URL" -f scripts/diagnostics.sql
-- ou copier-coller bloc par bloc dans le SQL Editor Supabase (les deux marchent :
-- le fichier ne contient aucune meta-commande psql).
--
-- La connection string porte le compte `postgres` (superuser) : il contourne
-- toutes les RLS. Ne jamais la déposer dans un fichier, même gitignoré — un
-- .env.diag avait été créé ainsi, et son mot de passe a dû être révoqué.
--
-- Lecture seule. Aucune donnée personnelle : ces tables ne portent ni adresse
-- ni montant exact (scan_debug, qui contient les adresses, est exclu à dessein).
--
-- Prérequis : migration 20260806_scan_failures.sql appliquée.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Les échecs des 7 derniers jours, par motif ─────────────────────────
-- C'est LA requête à lancer en premier. Un `la_start_failed` massif sur iOS
-- confirme le bug « le raccourci scanne mais rien ne s'affiche ».
select
  reason,
  os,
  app_version,
  count(*) as n,
  max(occurred_at) as dernier
from scan_failures
where occurred_at > now() - interval '7 days'
group by 1, 2, 3
order by n desc;


-- ─── 2. Taux d'échec réel ──────────────────────────────────────────────────
-- Un volume d'échecs ne veut rien dire sans le volume de succès en face.
select
  (select count(*) from scan_failures where occurred_at > now() - interval '24 hours') as echecs,
  (select count(*) from scan_events   where created_at  > now() - interval '24 hours') as succes,
  round(
    100.0 * (select count(*) from scan_failures where occurred_at > now() - interval '24 hours')
    / nullif(
        (select count(*) from scan_failures where occurred_at > now() - interval '24 hours')
      + (select count(*) from scan_events   where created_at  > now() - interval '24 hours'), 0),
    1
  ) as pct_echec;


-- ─── 3. Évolution jour par jour ────────────────────────────────────────────
-- Sert à dater l'apparition d'une panne et à vérifier qu'un correctif a pris.
select
  date_trunc('day', occurred_at)::date as jour,
  reason,
  count(*) as n
from scan_failures
where occurred_at > now() - interval '14 days'
group by 1, 2
order by 1 desc, n desc;


-- ─── 4. Combien de chauffeurs touchés ──────────────────────────────────────
-- Distingue « un testeur qui spamme » d'« une panne qui touche tout le parc ».
select
  reason,
  count(distinct user_id) as chauffeurs,
  count(*) as occurrences,
  round(count(*)::numeric / nullif(count(distinct user_id), 0), 1) as par_chauffeur
from scan_failures
where occurred_at > now() - interval '7 days'
group by 1
order by chauffeurs desc;


-- ─── 5. Détails bruts des motifs non catalogués ────────────────────────────
-- `other` = un motif hors vocabulaire fermé. Le brut est conservé dans `detail`.
-- Si cette liste se remplit, c'est qu'il manque un motif dans l'énumération.
select detail, os, count(*) as n
from scan_failures
where reason = 'other' and occurred_at > now() - interval '30 days'
group by 1, 2
order by n desc
limit 30;


-- ─── 6. Qualité de lecture sur les scans qui ABOUTISSENT ───────────────────
-- Complémentaire des échecs : un scan peut réussir en lisant mal. Le taux de
-- recours à Gemini et le nombre d'adresses trouvées sont les deux indicateurs
-- de santé du parser natif.
select
  platform,
  count(*) as scans,
  round(100.0 * avg((addresses_found = 2)::int), 1) as pct_2_adresses,
  round(100.0 * avg(gemini_fallback::int), 1)       as pct_gemini,
  round(100.0 * avg((duration_source = 'estimated')::int), 1) as pct_duree_estimee
from scan_events
where created_at > now() - interval '7 days'
group by 1
order by scans desc;


-- ─── 7. Répartition des verdicts ───────────────────────────────────────────
-- Un basculement brutal de cette répartition trahit souvent une régression de
-- parsing (tarif ou distance mal lus) avant même que quiconque ne s'en plaigne.
select
  date_trunc('day', created_at)::date as jour,
  count(*) filter (where verdict = 2) as vert,
  count(*) filter (where verdict = 1) as orange,
  count(*) filter (where verdict = 0) as rouge
from scan_events
where created_at > now() - interval '14 days'
group by 1
order by 1 desc;
