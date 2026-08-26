/**
 * Version de l'app — source unique pour l'UI (email support) et Sentry.
 *
 * Lit la version NATIVE du build installé (CFBundleShortVersionString /
 * versionName), exposée en constantes par ScanBridge. C'est la version des
 * stores, auto-incrémentée par EAS — contrairement à package.json (resté à
 * 1.0.0) ou à une constante hardcodée qui dérive à chaque release.
 * Fallback package.json si le module natif est absent (tests Jest).
 */
import { NativeModules } from 'react-native';
import { version as pkgVersion } from '../../package.json';

const native = (NativeModules.ScanBridge ?? {}) as {
  appVersion?: string;
  buildNumber?: string;
};

export const APP_VERSION: string = native.appVersion || pkgVersion;
export const BUILD_NUMBER: string = native.buildNumber || '';

/**
 * Libellé affichable, ex : « v2.4.1 ».
 *
 * SANS le numéro de build, jamais. C'est un détail de fabrication : il change à
 * chaque téléversement, y compris quand rien du produit ne bouge, et il ne veut
 * rien dire pour un chauffeur. « v2.4.1 (Build 78) » n'informe pas plus que
 * « v2.4.1 » — ça donne juste l'air d'un logiciel en chantier.
 *
 * La constante `BUILD_NUMBER` reste exportée : rien n'interdit de la joindre à
 * un diagnostic interne, mais elle ne doit pas entrer dans un libellé destiné à
 * être lu.
 */
export const APP_VERSION_LABEL: string = `v${APP_VERSION}`;
