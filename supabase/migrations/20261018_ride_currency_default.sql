-- ═══════════════════════════════════════════════════════════════════════════
-- La devise d'une course écrite par le natif iOS
-- ═══════════════════════════════════════════════════════════════════════════
-- `RideUploader` (ios/Strive/Scanner/ScanProcessor.swift) écrit la course dès
-- le scan, en session de fond, sans `currency` ni `fx_rate_eur`. L'app acquitte
-- ensuite la course sans la réécrire : l'insert JS, qui fige les deux, ressort
-- en conflit d'id et ne touche à rien. Toute course scannée par le raccourci
-- restait donc à NULL.
--
-- La lecture prend NULL pour de l'euro (`inCurrency`, src/services/fxService.ts).
-- Juste pour un chauffeur français ; faux à Londres et à Genève, où une course à
-- 20 £ comptait pour 20 €.
--
-- Corrigé ICI plutôt que dans le Swift : les builds déjà installés écrivent de
-- la même façon, et un trigger les couvre tous sans attendre une soumission.
-- La devise est celle du marché du chauffeur — `profiles.country`, la source de
-- `setMarket` côté app, avec le même calcul que 20260915_ride_currency.sql.
-- Le taux n'est connu ici que pour l'euro (1). Pour la livre et le franc, il
-- reste NULL : la lecture convertit alors au taux du jour, ce qui ne se voit que
-- chez un chauffeur qui a changé de marché.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.default_ride_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.currency is null then
    select case p.country
             when 'CH' then 'CHF'
             when 'GB' then 'GBP'
             else 'EUR'
           end
      into new.currency
      from public.profiles p
     where p.id = new.user_id;
    -- Profil introuvable : l'euro plutôt que rien, comme le filet de 20260915.
    new.currency := coalesce(new.currency, 'EUR');
  end if;
  if new.fx_rate_eur is null and new.currency = 'EUR' then
    new.fx_rate_eur := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists ride_currency_default on public.rides;
create trigger ride_currency_default
  before insert on public.rides
  for each row execute function public.default_ride_currency();

-- Rattrapage des courses déjà écrites à NULL.
update public.rides r
   set currency = case p.country
                    when 'CH' then 'CHF'
                    when 'GB' then 'GBP'
                    else 'EUR'
                  end
  from public.profiles p
 where p.id = r.user_id
   and r.currency is null;

update public.rides
   set currency = 'EUR'
 where currency is null;

update public.rides
   set fx_rate_eur = 1
 where currency = 'EUR'
   and fx_rate_eur is null;
