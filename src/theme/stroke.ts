// src/theme/stroke.ts

import { StyleSheet } from 'react-native';

/**
 * Bords.
 *
 * L'app comptait 21 `borderColor` distincts, dont 6 opacités pour ce qui est un
 * seul objet conceptuel : le bord discret d'une surface. Une constante
 * `HAIRLINE` avait même été écrite deux fois séparément, à 0.07 dans
 * DiagnosticsScreen et à 0.09 dans TutorialScreen. Le besoin s'est fait sentir
 * deux fois sans jamais remonter ici.
 *
 * LE BORD SUIT LE MATÉRIAU, et c'est la seule règle qui compte ici :
 *
 *   - une surface OPAQUE se délimite par un trait. Elle a une arête franche,
 *     le trait la dit ;
 *   - une surface de VERRE se délimite par un liseré lumineux en dégradé. Le
 *     verre capte la lumière le long de sa courbe, ce qui est une intensité
 *     variable, pas une ligne. Un aplat de 1 px posé sur un bord arrondi laisse
 *     voir ses extrémités carrées près de la courbe — `TabNavigator` documente
 *     précisément ce défaut sur son `shimmer`, et c'est pour ça que le reflet de
 *     la capsule est un dégradé et non une bordure.
 *
 * Mettre un trait net sur du verre, ou un halo sur une arête franche, sont la
 * même erreur dans les deux sens : le bord cesse de dire de quoi l'objet est
 * fait. Les valeurs ci-dessous ne couvrent que le cas opaque ; le verre se
 * traite avec un `SafeGradient` en liseré, pas avec une `borderColor`.
 */
export const stroke = {
  /** Bord d'une surface opaque posée sur le fond. Le cas par défaut. */
  edge: 'rgba(255,255,255,0.08)',

  /** Bord d'une surface opaque plus haute, qui capte davantage la lumière. */
  edgeLit: 'rgba(255,255,255,0.15)',

  /** Bord d'un contrôle opaque sélectionné. */
  active: 'rgba(0,230,118,0.5)',

  /** Bord d'un champ ou d'une carte en erreur. */
  alert: 'rgba(255,77,77,0.45)',
} as const;

/**
 * Épaisseurs. Deux, et c'est tout.
 *
 * Le bord d'une SURFACE prend le trait le plus fin que l'écran sache produire :
 * il délimite sans se faire remarquer. Le contour d'un CONTRÔLE prend un pixel
 * plein, sinon il disparaît sur un écran dense. Les 1.5, 2 et 2.5 qui
 * circulaient étaient de l'emphase décidée au cas par cas.
 */
export const strokeWidth = {
  surface: StyleSheet.hairlineWidth,
  control: 1,
} as const;
