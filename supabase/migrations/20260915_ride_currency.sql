-- ════════════════════════════════════════════════════════════════════════════
-- La devise d'une course — `rides.currency`
--
-- POURQUOI. `fare_estimated` est un NOMBRE NU. Tant que l'app n'avait qu'un
-- marché, la devise se déduisait : c'était l'euro, toujours. Avec six marchés,
-- changer de devise ne convertissait rien — ça RÉINTERPRÉTAIT tout
-- l'historique. Une course à 20 € gagnée à Paris s'affichait « £20 » le
-- lendemain d'un passage à la livre, et les totaux mélangeaient les deux sans
-- que rien ne le signale.
--
-- CE QUI EST ÉCRIT, ET CE QUI EST CALCULÉ. La colonne porte ce que la course a
-- RÉELLEMENT rapporté, et rien d'autre : le chauffeur a encaissé 20 €, c'est ce
-- qu'il compare à son relevé bancaire, et aucune bascule de marché ne le
-- réécrit. La ligne d'historique affiche donc toujours « 20 € ».
--
-- La conversion existe, mais uniquement pour les TOTAUX, et uniquement en
-- lecture : additionner 200 € et 150 £ ne désigne rien, il faut bien une monnaie
-- commune. Ce chiffre-là est une consolidation, pas une écriture — il n'est
-- jamais renvoyé en base.
--
-- LE REMPLISSAGE. Les courses existantes prennent la devise du marché de leur
-- chauffeur au moment de la migration. C'est exact pour tout le monde
-- aujourd'hui : `profiles.country` vaut 'FR' partout (cf. 20260915_profile_
-- country.sql, qui vient d'être posée), et l'app n'a jamais tourné ailleurs.
-- La jointure plutôt qu'un 'EUR' en dur pour que la migration reste juste si
-- elle est rejouée sur un environnement déjà multi-marché.
--
-- ⚠️ À DÉPLOYER AVANT le build qui lit la colonne. Sans elle, la projection de
--    `ridesService` échoue et la liste des courses reste vide.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.rides
  add column if not exists currency text;

-- Les trois devises des marchés couverts. Même liste que `Currency` dans
-- src/utils/market.ts et que `profiles_country_check` : une devise inconnue
-- n'a pas de symbole côté app, elle s'afficherait comme un nombre nu.
alter table public.rides
  drop constraint if exists rides_currency_check;

alter table public.rides
  add constraint rides_currency_check
  check (currency is null or currency in ('EUR', 'CHF', 'GBP'));

update public.rides r
   set currency = case p.country
                    when 'CH' then 'CHF'
                    when 'GB' then 'GBP'
                    else 'EUR'
                  end
  from public.profiles p
 where p.id = r.user_id
   and r.currency is null;

-- Filet : une course dont le profil aurait disparu garde une devise plutôt que
-- rien. `null` s'afficherait sans symbole du tout.
update public.rides
   set currency = 'EUR'
 where currency is null;

comment on column public.rides.currency is
  'Devise dans laquelle cette course a ete gagnee (EUR, CHF, GBP). Figee a la '
  'creation : changer de marche ne la reecrit pas. Les totaux consolident les '
  'autres devises au taux figé dans fx_rate_eur, en lecture seule.';

-- ════════════════════════════════════════════════════════════════════════════
-- Le taux de change AU MOMENT DU SCAN — `rides.fx_rate_eur`
--
-- Combien d'unités de `currency` valait 1 EUR quand la course a été scannée.
-- 1 pour une course en euros, ~0,85 pour une course en livres.
--
-- POURQUOI LE FIGER. Un total consolidé calculé au taux DU JOUR change tous les
-- jours. Le chauffeur qui relève « 2 340 € ce mois-ci » lit 2 358 € la semaine
-- suivante sans avoir roulé : son relevé cesse d'être un relevé. En figeant le
-- taux à la course, la valeur de chaque course dans la monnaie pivot ne bouge
-- plus jamais — c'est ce que font les logiciels de comptabilité, et pour
-- exactement cette raison.
--
-- CE QUI BOUGE ENCORE, ET C'EST NORMAL. La dernière conversion — de l'euro vers
-- la devise que le chauffeur a choisie — suit le taux du jour. C'est une
-- présentation, pas une écriture, et l'écran le dit.
--
-- `null` sur les courses antérieures : elles étaient toutes en euros, donc leur
-- taux vaut 1 et l'app le déduit sans avoir besoin de la colonne.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.rides
  add column if not exists fx_rate_eur numeric(12, 6);

alter table public.rides
  drop constraint if exists rides_fx_rate_check;

-- Bornes larges mais pas infinies : un taux nul ferait une division par zéro
-- dans le calcul du total, et un taux absurde passerait inaperçu dans une somme.
alter table public.rides
  add constraint rides_fx_rate_check
  check (fx_rate_eur is null or (fx_rate_eur > 0.01 and fx_rate_eur < 100));

update public.rides
   set fx_rate_eur = 1
 where fx_rate_eur is null
   and currency = 'EUR';

comment on column public.rides.fx_rate_eur is
  'Unites de `currency` pour 1 EUR, figees au scan. Rend la valeur pivot de la '
  'course immuable : un total passe ne bouge plus. null = course anterieure, '
  'donc en euros, donc 1.';

-- L'index sert les Stats et l'Historique, qui filtrent tous deux sur
-- (user_id, currency) avant d'agréger.
create index if not exists rides_user_currency_idx
  on public.rides (user_id, currency);

-- ════════════════════════════════════════════════════════════════════════════
-- Vérification manuelle
--
--   select currency, count(*) from rides group by currency;
--   → une seule ligne ('EUR', n) sur un environnement encore franco-francais.
--
--   update rides set currency = 'USD' where id = '<un id>';
--   → ERROR: new row violates check constraint "rides_currency_check"
-- ════════════════════════════════════════════════════════════════════════════
