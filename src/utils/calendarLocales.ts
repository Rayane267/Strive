/**
 * Mois et jours du calendrier, dans les sept langues de l'app.
 *
 * `react-native-calendars` tient son propre registre de locales, séparé
 * d'i18next : les noms de mois ne sont pas des clés de traduction, ce sont des
 * tableaux que la bibliothèque indexe par numéro. Sans enregistrement, elle
 * retombe sur son défaut anglais — un chauffeur portugais lisait « September »
 * au milieu d'un écran en portugais.
 *
 * ── POURQUOI ICI ET PAS DANS CHAQUE ÉCRAN ─────────────────────────────────
 * Le français et l'anglais étaient définis DEUX FOIS, à l'identique, dans
 * Analytics et dans Historique. Deux copies d'une même table ne restent pas
 * longtemps identiques, et le registre de la bibliothèque est global de toute
 * façon : le dernier écran monté écrasait le premier. Un seul endroit, importé
 * par les deux.
 *
 * ── LES ABRÉVIATIONS NE SE DEVINENT PAS ───────────────────────────────────
 * Chaque langue abrège à sa manière, et la règle n'est pas « les trois
 * premières lettres ». L'allemand écrit « Mär » et non « Mar », l'italien ne
 * met pas de point, le néerlandais abrège « mrt » en sautant une lettre du
 * milieu. Les tables ci-dessous sont écrites à la main pour cette raison.
 *
 * ── LA SEMAINE COMMENCE LE DIMANCHE ───────────────────────────────────────
 * `dayNames` est indexé par `Date.getDay()`, où 0 vaut dimanche. L'ordre des
 * tableaux suit donc cette convention même dans les pays où la semaine commence
 * le lundi — c'est l'index qui compte, pas l'affichage, que la bibliothèque
 * décale elle-même via `firstDay`.
 */
import { LocaleConfig } from 'react-native-calendars';

type CalendarLocale = {
  monthNames: string[];
  monthNamesShort: string[];
  dayNames: string[];
  dayNamesShort: string[];
  today: string;
};

export const CALENDAR_LOCALES: Record<string, CalendarLocale> = {
  fr: {
    monthNames: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
    monthNamesShort: ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'],
    dayNames: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
    dayNamesShort: ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'],
    today: "Aujourd'hui",
  },
  en: {
    monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthNamesShort: ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'],
    dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    dayNamesShort: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
    today: 'Today',
  },
  es: {
    monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    monthNamesShort: ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.', 'Jul.', 'Ago.', 'Sept.', 'Oct.', 'Nov.', 'Dic.'],
    dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    dayNamesShort: ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'],
    today: 'Hoy',
  },
  pt: {
    monthNames: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
    monthNamesShort: ['Jan.', 'Fev.', 'Mar.', 'Abr.', 'Mai.', 'Jun.', 'Jul.', 'Ago.', 'Set.', 'Out.', 'Nov.', 'Dez.'],
    dayNames: ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'],
    dayNamesShort: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
    today: 'Hoje',
  },
  nl: {
    monthNames: ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'],
    // « mrt » saute le « a » du milieu — c'est l'abréviation d'usage, pas « maa ».
    monthNamesShort: ['Jan.', 'Feb.', 'Mrt.', 'Apr.', 'Mei', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dec.'],
    dayNames: ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'],
    dayNamesShort: ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'],
    today: 'Vandaag',
  },
  de: {
    monthNames: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    // « Mär » garde le tréma : « Mar » n'est pas une abréviation allemande.
    monthNamesShort: ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
    dayNames: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    dayNamesShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    today: 'Heute',
  },
  it: {
    monthNames: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
    // L'italien n'abrège pas avec un point.
    monthNamesShort: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'],
    dayNames: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
    dayNamesShort: ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'],
    today: 'Oggi',
  },
};

// Enregistrement au chargement du module : la bibliothèque lit son registre au
// rendu, donc il doit être rempli avant le premier calendrier affiché.
for (const [code, locale] of Object.entries(CALENDAR_LOCALES)) {
  LocaleConfig.locales[code] = locale;
}

/**
 * La langue à demander au calendrier, repliée sur l'anglais si elle n'a pas de
 * table.
 *
 * Le repli n'est pas théorique : i18next peut rendre un code régional
 * (« pt-BR ») là où le registre ne connaît que « pt ». On coupe donc au premier
 * tiret avant de chercher.
 */
export function calendarLocale(language: string | undefined): string {
  const base = (language ?? 'en').split('-')[0];
  return CALENDAR_LOCALES[base] ? base : 'en';
}
