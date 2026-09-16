/**
 * L'URL iCloud du raccourci pré-construit — une seule fois, pour tout le monde.
 *
 * Le raccourci enchaîne « Prendre une capture d'écran » et « Analyser une
 * course avec Strive ». C'est LUI le produit sur iOS : sans lui, l'App Intent
 * n'est jamais appelé et l'app ne scanne rien.
 *
 * ⚠️ Pourquoi une constante partagée plutôt qu'un littéral dans chaque écran.
 * L'URL vivait en double, dans TutorialScreen et dans ScannerPermissionScreen.
 * Le second est resté à `null` pendant que le premier recevait la vraie valeur :
 * le chauffeur qui passait par le Dashboard au lieu du tutoriel atterrissait
 * dans une app Raccourcis VIDE, à composer le raccourci à la main. Deux copies
 * d'une même adresse divergent toujours ; il n'y en a plus qu'une.
 */
export const PREBUILT_SHORTCUT_URL =
  'https://www.icloud.com/shortcuts/d678e4a771654387866c5621e97cc58a';
