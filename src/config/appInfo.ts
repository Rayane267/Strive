/**
 * Source unique de la version applicative affichée dans l'UI.
 *
 * Valeurs lues au runtime depuis le bundle natif via react-native-device-info :
 *  - iOS   : CFBundleShortVersionString / CFBundleVersion (Info.plist)
 *  - Android : versionName / versionCode (build.gradle)
 *
 * Sous EAS Build (`appVersionSource: remote`, `autoIncrement: true`), le numéro
 * de build est assigné par EAS au moment du build et injecté dans le bundle —
 * `getBuildNumber()` renvoie donc la vraie valeur, sans mise à jour manuelle.
 */
import DeviceInfo from 'react-native-device-info';

export const APP_VERSION = DeviceInfo.getVersion();
export const APP_BUILD = DeviceInfo.getBuildNumber();

/** Ex. "v2.4.1 (Build 204)" — format affiché en pied de l'écran Profil. */
export const APP_VERSION_LABEL = `v${APP_VERSION} (Build ${APP_BUILD})`;
