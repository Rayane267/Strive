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

/** Libellé affichable, ex : "v2.4.1 (Build 204)". */
export const APP_VERSION_LABEL: string = BUILD_NUMBER
  ? `v${APP_VERSION} (Build ${BUILD_NUMBER})`
  : `v${APP_VERSION}`;
