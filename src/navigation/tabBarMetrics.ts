/**
 * Géométrie de la capsule d'onglets (Android ; iOS avant la barre native).
 *
 * Partagée parce que `useBottomTabBarHeight` ne la connaît pas : seule la barre
 * par défaut de React Navigation remonte sa hauteur, et la capsule est dessinée
 * à la main. Le hook renvoie donc l'estimation d'une barre standard (~20 pt de
 * moins), et un écran plein cadre qui s'y fierait poserait son contenu sous la
 * capsule.
 */

export const PILL_HEIGHT = 62;

/** Du bas de l'écran au bas de la capsule. */
export const tabBarBottom = (insetBottom: number) => Math.max(insetBottom, 16) + 8;

/** Du bas de l'écran au HAUT de la capsule : ce qu'un écran plein cadre doit
 *  laisser libre. */
export const tabBarClearance = (insetBottom: number) =>
  tabBarBottom(insetBottom) + PILL_HEIGHT;
