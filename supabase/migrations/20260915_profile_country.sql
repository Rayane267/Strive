-- ═══════════════════════════════════════════════════════════════════════════
-- Pays du chauffeur — `profiles.country`
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI. Tout le calcul de Strive était français sans le dire : le prix du
-- carburant lisait la ligne `paris` de `fuel_prices`, et les taux de cotisations
-- étaient ceux de l'Urssaf. Tant que l'app ne roulait qu'en France, l'implicite
-- tenait. Il ne tient plus : à l'ouverture du Royaume-Uni, de la Belgique, de
-- l'Espagne, du Portugal et de la Suisse, un même profil doit produire un seuil
-- différent — et c'est le PAYS D'ACTIVITÉ qui le dit, pas la langue du
-- téléphone (`fr` ne sépare pas la France de la Belgique ni de la Suisse, `nl`
-- ne sépare pas les Pays-Bas de la Belgique).
--
-- L'app détecte la région de l'appareil par défaut, mais c'est un point de
-- départ, pas une vérité : un chauffeur peut rouler à Bruxelles avec un
-- téléphone configuré en France. Cette colonne porte le choix, et il prime.
--
-- NULL VEUT DIRE QUELQUE CHOSE. Un profil sans pays n'est pas un profil
-- français : c'est un profil dont on ne sait pas encore. L'app retombe alors
-- sur la région de l'appareil, puis sur la France. Mettre `default 'FR'`
-- ferait taire cette distinction et imposerait des cotisations françaises à un
-- nouveau chauffeur britannique dont la ligne n'aurait pas encore été écrite.
--
-- EN REVANCHE les profils EXISTANTS sont français — l'app n'a jamais été
-- distribuée ailleurs — et on l'écrit, plutôt que de les laisser dépendre de la
-- région d'un téléphone qui peut être en voyage.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists country text;

-- Les six marchés couverts. La contrainte est là pour que le jour où un code
-- inattendu arrive du client, il soit refusé à l'écriture plutôt que de
-- traverser jusqu'au calcul du seuil, où il retomberait silencieusement sur la
-- France.
alter table public.profiles
  drop constraint if exists profiles_country_check;
alter table public.profiles
  add constraint profiles_country_check
  check (country is null or country in ('FR', 'BE', 'CH', 'ES', 'PT', 'GB'));

-- Backfill : tout ce qui existe aujourd'hui roule en France.
update public.profiles
   set country = 'FR'
 where country is null;

comment on column public.profiles.country is
  'Pays d''activité (ISO 3166-1 alpha-2), parmi les marchés couverts. Détermine '
  'la devise, l''unité de distance, la source du prix carburant et le régime de '
  'cotisations — voir src/utils/market.ts. NULL = pas encore connu : l''app '
  'retombe sur la région de l''appareil.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Prix du carburant saisi par le chauffeur — `profiles.fuel_price`
-- ═══════════════════════════════════════════════════════════════════════════
-- POURQUOI PAS UNE LIGNE PAR PAYS DANS `fuel_prices`. Il aurait fallu bâtir un
-- relevé quotidien pour cinq pays avant d'ouvrir quoi que ce soit — ou semer
-- des moyennes inventées dans la table même qui calcule le bénéfice net de
-- chaque course. Le chauffeur, lui, connaît le prix de SA station au centime
-- près, et c'est de toute façon plus juste qu'une moyenne nationale : il fait
-- le plein toujours au même endroit.
--
-- La colonne existe pour TOUS les marchés, France comprise : un chauffeur
-- parisien qui saisit son prix doit être cru plutôt que moyenné. La différence
-- est qu'en France il n'a rien à faire s'il ne veut pas — la ligne `paris`
-- prend le relais (cf. `market.fuelKey`).
--
-- Jumelle de `elec_price`, qui suit cette logique depuis toujours : la recharge
-- n'a jamais eu de source marché, domicile et borne allant du simple au triple.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists fuel_price numeric(6, 3);

-- Bornes larges à dessein : elles couvrent le litre comme le gallon, l'euro
-- comme le franc et la livre. Elles n'existent que pour arrêter une faute de
-- frappe à l'écriture — un 18,50 tapé pour 1,85 fait un coût carburant dix fois
-- trop grand et un bénéfice net négatif sur toutes les courses.
alter table public.profiles
  drop constraint if exists profiles_fuel_price_check;
alter table public.profiles
  add constraint profiles_fuel_price_check
  check (fuel_price is null or (fuel_price > 0 and fuel_price <= 10));

comment on column public.profiles.fuel_price is
  'Prix du carburant au litre, saisi par le chauffeur (Réglages → Véhicule), dans '
  'la devise de son marché. Prime sur la table fuel_prices. SEULE source hors de '
  'France, où aucun relevé n''alimente la table — voir market.fuelKey.';


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. La colonne existe et tous les profils sont français :
--    select country, count(*) from profiles group by country;
--    → FR = total, aucune ligne null
--
-- 2. La contrainte mord :
--    update profiles set country = 'US' where id = '<un id>';
--    → ERROR: new row violates check constraint "profiles_country_check"
--
-- 3. Le prix saisi est borné :
--    update profiles set fuel_price = 18.5 where id = '<un id>';
--    → ERROR: violates check constraint "profiles_fuel_price_check"
--    update profiles set fuel_price = 1.85 where id = '<un id>';  → OK
--
--    `fuel_prices` n'est PAS touchée : elle garde sa seule ligne `paris`.
--
-- 4. Un chauffeur français ne voit AUCUN changement : 'FR' rend exactement les
--    valeurs d'avant — ligne `paris`, micro-BIC à 21,2 %, plancher 25 €/h.
