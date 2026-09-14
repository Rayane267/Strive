// src/theme/radius.ts

/**
 * Échelle de rayons d'angle.
 *
 * Le code en comptait 39 distincts, dont 9, 11, 13 et 29 : chaque composant
 * avait improvisé sa forme dans son coin. L'œil ne lit pas 39 rayons comme de
 * la variété, il les lit comme une absence de décision. Cinq crans suffisent,
 * et c'est leur répétition qui finit par se lire comme une intention.
 *
 * Les valeurs ne sont pas neuves : ce sont celles qui dominaient déjà l'app
 * (14 revenait 34 fois, 22 dix fois). On garde la forme existante, on retire le
 * bruit autour d'elle.
 */
export const radius = {
  /** Graduations, embouts de barre de progression, filets. */
  xs: 6,
  /** Petits contrôles : puces, badges, vignettes d'icône. */
  sm: 10,
  /** La carte. Surface par défaut de l'app. */
  md: 14,
  /** Grande carte, feuille modale, conteneur pleine largeur. */
  lg: 22,
  /**
   * Pilules, avatars, boutons entièrement arrondis.
   *
   * LA RÈGLE : un CONTRÔLE est une pilule, une SURFACE est une carte.
   *
   * Un bouton d'action, une puce de filtre, un sélecteur de date sont des
   * contrôles — on les touche, ils font quelque chose. Une carte est un endroit
   * où l'on pose du contenu. Treize contrôles portaient un rayon de carte, ce
   * qui les faisait lire comme des blocs de contenu qu'on aurait rendus
   * cliquables par accident.
   *
   * Le corollaire compte autant : si une surface de verre double un contrôle,
   * elle doit prendre le MÊME rayon, sinon le flou reste découpé en carte sous
   * une pilule et le bord se dédouble.
   */
  full: 999,
} as const;

export type RadiusToken = keyof typeof radius;

/**
 * Rayon d'un élément posé À L'INTÉRIEUR d'un conteneur arrondi.
 *
 * Deux arrondis concentriques doivent partager leur centre de courbure. Sinon
 * l'épaisseur entre les deux bords enfle dans les coins, et le contenu paraît
 * mal calé sans qu'on sache dire pourquoi. La règle est géométrique, pas
 * affaire de goût :
 *
 *     rayon intérieur = rayon extérieur − marge intérieure
 *
 * Une carte `md` (14) avec 8 px de padding demande donc un contenu à 6, pas à
 * 14. C'est le détail qui sépare une carte dessinée d'une carte assemblée, et
 * aucune des 39 valeurs de l'app ne le respectait.
 *
 * Le plancher à 2 évite le coin vif quand la marge dépasse le rayon : un angle
 * strictement droit au fond d'un conteneur arrondi se voit autant qu'une erreur.
 */
export function innerRadius(outer: number, inset: number): number {
  return Math.max(2, outer - inset);
}
