/**
 * `t()` qui connaît la devise et l'unité de distance du chauffeur.
 *
 * Une vingtaine de phrases de l'app parlaient d'argent en dur : « €/h en
 * direct », « Vos seuils €/h et €/km », « configurez un seuil de 20€/h ». Elles
 * ne faussaient aucun verdict — ce sont des arguments, pas des chiffres de
 * course — mais un chauffeur londonien lisait l'app dans une monnaie qui n'est
 * pas la sienne partout SAUF sur les écrans qui comptent. Une app qui hésite
 * sur sa propre monnaie n'inspire pas de confiance sur le reste.
 *
 * ── POURQUOI UN WRAPPER ET PAS UNE VARIABLE À CHAQUE APPEL ────────────────
 * Les écrans concernés appellent `t()` avec des clés CONSTRUITES : l'aide fait
 * `t(\`help.faq.${key}\`)` sur douze questions, le tutoriel `t(\`tutorial.quickRef.
 * ${os}.step${n}Sub\`)`. Passer les variables à la main demanderait de les
 * répéter à chaque appel, y compris sur les clés qui n'en ont pas besoin, et la
 * prochaine phrase ajoutée les oublierait. Ici, elles sont là par défaut et
 * chaque appel peut toujours les surcharger.
 *
 * ── CE QUE LES TRADUCTIONS PEUVENT UTILISER ───────────────────────────────
 * `{{cur}}`       le symbole : « € », « CHF », « £ »
 * `{{unit}}`      l'unité de distance : « km », ou « mi » au Royaume-Uni
 * `{{cons}}`      la consommation : « L/100km », ou « mpg » au Royaume-Uni
 * `{{consElec}}`  la même en électrique : « kWh/100km », ou « mi/kWh »
 *
 * Volontairement PAS de `{{hr}}` tout fait : « par heure » s'abrège
 * différemment selon la langue (« /h », « /hr », « /u », « /Std. ») et cette
 * partie-là appartient à la traduction, pas au marché. Les phrases écrivent
 * donc « {{cur}}/u » et gardent leur propre abréviation.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMarket } from './useMarket';
import { consumptionUnit } from '../utils/market';

type TOptions = Record<string, unknown>;

export function useMarketT() {
  const { t, i18n } = useTranslation();
  const market = useMarket();

  const marketT = useCallback(
    (key: string | string[], options?: TOptions | string): string => {
      const vars = {
        cur: market.symbol,
        unit: market.distanceUnit,
        cons: consumptionUnit(market, false),
        consElec: consumptionUnit(market, true),
      };
      // Second argument en chaîne = valeur par défaut, forme courante d'i18next
      // qu'on ne peut pas casser sans réécrire des dizaines d'appels.
      const opts =
        typeof options === 'string'
          ? { ...vars, defaultValue: options }
          : { ...vars, ...options };
      return t(key as string, opts) as unknown as string;
    },
    [t, market],
  );

  // Même forme de retour que `useTranslation` : l'échange se fait en une ligne
  // dans l'écran, et rien d'autre ne bouge.
  return useMemo(() => ({ t: marketT, i18n }), [marketT, i18n]);
}
