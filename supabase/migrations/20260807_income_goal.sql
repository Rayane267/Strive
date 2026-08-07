-- ═══════════════════════════════════════════════════════════════════════════
-- Objectif de revenu, temps de travail et charges fixes
-- ═══════════════════════════════════════════════════════════════════════════
-- Collectés dans `OnboardingScreen` (premier lancement, avant le tutoriel).
-- Servent à DÉRIVER le seuil horaire au lieu de demander au chauffeur de le
-- deviner sur un curseur de 10 à 80 € — question à laquelle personne ne sait
-- répondre, alors que « combien je veux gagner » et « combien d'heures je roule »
-- sont immédiats.
--
-- À ne pas confondre avec la slide « seuils » du tutoriel, qui reste purement
-- informative : ses curseurs ne sont jamais persistés (`TutorialScreen.savePreferences`
-- n'écrit que `include_pickup`). L'onboarding est le seul écrivain des seuils.
--
--   CA nécessaire = (objectif net + charges fixes) / (1 − taux de charges sociales)
--   seuil horaire = CA nécessaire / (heures/sem × 4,33)
--
-- Le terme des charges sociales n'est pas cosmétique : sans lui, le seuil dérivé
-- tombait sous le plancher de rentabilité dans TOUS les cas réalistes (17 €/h
-- pour 2 500 € net à 45 h), et les trois questions n'avaient donc aucun effet.
--
-- ⚠️ Le seuil appliqué est plafonné par le bas au seuil de rentabilité
-- (FREE_THRESHOLDS) : un objectif modeste produit un seuil sous ce point, et
-- l'app validerait alors des courses qui font perdre de l'argent une fois
-- l'usure et les charges comptées. Voir utils/incomeGoal.deriveThreshold().
--
-- Ces valeurs restent indicatives : min_hourly_rate / min_km_rate demeurent
-- la source de vérité du verdict, et l'utilisateur peut toujours les surcharger.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.preferences
  add column if not exists monthly_goal  numeric(8,2),
  add column if not exists weekly_hours  numeric(5,1),
  add column if not exists fixed_costs   numeric(8,2),
  -- Statut déclaré : sert aux agrégats produit. Le calcul, lui, n'utilise que
  -- `social_rate` — ce qui permet à « Autre » de porter un taux libre sans
  -- inventer une catégorie.
  add column if not exists driver_status text,
  add column if not exists social_rate   numeric(4,3),
  -- Plateformes utilisées. Ne sert à aucun calcul : personnalise le tutoriel
  -- (quelle app montrer en exemple) et donne le mix marché en agrégat.
  add column if not exists platforms     text[];

-- Bornes de cohérence : rejettent une saisie aberrante sans contraindre les cas
-- réels (temps partiel à 5 h/semaine, gros rouleur à 80 h).
alter table public.preferences
  drop constraint if exists preferences_monthly_goal_range;
alter table public.preferences
  add constraint preferences_monthly_goal_range
  check (monthly_goal is null or (monthly_goal >= 0 and monthly_goal <= 100000));

alter table public.preferences
  drop constraint if exists preferences_weekly_hours_range;
alter table public.preferences
  add constraint preferences_weekly_hours_range
  check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 100));

alter table public.preferences
  drop constraint if exists preferences_fixed_costs_range;
alter table public.preferences
  add constraint preferences_fixed_costs_range
  check (fixed_costs is null or (fixed_costs >= 0 and fixed_costs <= 100000));

alter table public.preferences
  drop constraint if exists preferences_social_rate_range;
alter table public.preferences
  add constraint preferences_social_rate_range
  check (social_rate is null or (social_rate >= 0 and social_rate < 0.95));

alter table public.preferences
  drop constraint if exists preferences_driver_status_values;
alter table public.preferences
  add constraint preferences_driver_status_values
  check (driver_status is null
         or driver_status in ('auto_entrepreneur', 'societe', 'salarie', 'autre'));

alter table public.preferences
  drop constraint if exists preferences_platforms_values;
alter table public.preferences
  add constraint preferences_platforms_values
  check (platforms is null or platforms <@ array['UBER','BOLT','HEETCH']::text[]);

comment on column public.preferences.platforms is
  'Plateformes déclarées par le chauffeur (UBER / BOLT / HEETCH). Indicatif, aucun calcul.';
comment on column public.preferences.driver_status is
  'Statut déclaré : auto_entrepreneur | societe | salarie | autre. Indicatif — le calcul utilise social_rate.';
comment on column public.preferences.social_rate is
  'Part du chiffre d''affaires reversée en charges sociales (0.22 = 22 %). Saisissable librement via « Autre ».';
comment on column public.preferences.monthly_goal is
  'Revenu net mensuel visé par le chauffeur, en euros. Sert à dériver le seuil horaire.';
comment on column public.preferences.weekly_hours is
  'Heures travaillées par semaine. Convertie en mois via le facteur 4,33.';
comment on column public.preferences.fixed_costs is
  'Charges fixes mensuelles (location/LOA, assurance…), en euros. Ajoutées à l''objectif avant dérivation.';
