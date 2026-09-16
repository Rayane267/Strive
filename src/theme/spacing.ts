// src/theme/spacing.ts

/**
 * Échelle d'espacement.
 *
 * `src/` contenait 27 valeurs de padding distinctes, en gros tous les entiers de
 * 2 à 20, plus 22, 24, 28, 32, 34, 40, 48 et 60. Un écart de 2 px décidé au cas
 * par cas ne se voit pas isolément mais se sent partout : c'est ce qui donne
 * l'impression qu'une interface a été assemblée pièce par pièce.
 *
 * Huit crans, sur une base de 4, encadrés par deux exceptions assumées : `tight`
 * en dessous pour l'espace entre deux lignes d'un même propos, `xxxl` au-dessus
 * pour la respiration d'un état vide. Les deux ont été ajoutés APRÈS la
 * migration, parce que rabattre les valeurs concernées sur les crans ronds
 * dégradait visiblement le résultat — pas par confort.
 *
 * La contrainte reste le but. Quand une valeur ne tombe pas dans l'échelle, la
 * question est d'abord de savoir si c'est la composition qui est bancale ; la
 * réponse n'a été « non » que deux fois.
 *
 * Une valeur reste hors échelle : le `paddingLeft: 1` du rail d'itinéraire de
 * l'Historique. C'est un calage optique et non du rythme, et cette catégorie-là
 * n'a rien à faire dans une échelle d'espacement.
 */
export const space = {
  /**
   * Entre deux lignes d un MÊME propos : un titre et son sous-titre, une valeur
   * et son unité, deux pastilles reliées par un filet.
   *
   * Le cran existe parce que huit de ces écarts valaient 2 ou 3 px dans le code
   * et que les rabattre sur 4 desserrait ce qui devait rester lié. « Groupes
   * serrés, séparations généreuses » : voici le côté serré, et il ne se négocie
   * pas contre la régularité de l échelle.
   */
  tight: 2,
  /** Entre une icône et son libellé, entre deux éléments d'un même mot. */
  xs: 4,
  /** À l'intérieur d'un petit contrôle, entre deux lignes d'un même bloc. */
  sm: 8,
  /** Padding d'une carte dense, gouttière d'une grille. */
  md: 12,
  /** Padding d'une carte ordinaire, marge latérale d'écran. */
  lg: 16,
  /** Entre deux blocs qui ne parlent pas de la même chose. */
  xl: 24,
  /** Avant un nouveau chapitre d'écran. */
  xxl: 32,
  /**
   * Respiration d'un état vide ou d'un écran d'accueil.
   *
   * Le septième cran existe parce que le code contenait des 48 et des 60, et
   * qu'ils n'étaient pas du bruit : ce sont les grands vides qui font qu'un
   * écran sans contenu ne ressemble pas à un écran cassé. Les rabattre sur 32
   * aurait serré exactement ce qui devait rester large.
   */
  xxxl: 48,
} as const;

export type SpaceToken = keyof typeof space;

/**
 * Espace au-dessus et en dessous d'un titre de section.
 *
 * Un titre appartient à ce qui le SUIT, pas à ce qui le précède. Il lui faut
 * donc plus d'air au-dessus qu'en dessous, sinon il flotte entre deux blocs et
 * l'œil ne sait pas lequel il annonce. C'est une des rares règles de mise en
 * page qui se vérifie à la mesure : dans presque toutes les interfaces générées,
 * ces deux valeurs sont égales.
 */
export const headingSpace = {
  above: space.xl,
  below: space.sm,
} as const;
