// src/theme/field.ts

/**
 * Le champ lumineux.
 *
 * L'écran n'est pas une toile sur laquelle on pose des objets, c'est un champ
 * dans lequel ils sont plongés. La distinction n'est pas une image : elle veut
 * dire qu'un élément n'a pas une apparence fixe, il a une apparence QUI DÉPEND
 * DE SA POSITION. Deux cartes identiques, l'une en haut et l'autre en bas, ne
 * doivent pas se ressembler.
 *
 * La lumière monte du BAS. Le haut de l'écran s'enfonce.
 *
 * Ce sens a été inversé une fois, puis remis. Il vaut la peine de dire pourquoi,
 * parce que les deux arguments sont bons et que seul l'essai les départage.
 *
 * L'argument du vert EN HAUT : la barre d'onglets est une capsule sombre qui
 * flotte en bas et se détache mieux sur du noir ; la densité de contenu augmente
 * vers le bas ; la zone de barre d'état est l'endroit le moins cher pour poser
 * la couleur de marque. C'est ce que fait la plupart des apps sombres.
 *
 * L'argument du vert EN BAS, celui qui a gagné à l'écran : la couleur arrive là
 * où le pouce travaille et où le regard revient, au lieu de décorer une zone que
 * personne ne regarde. Le haut sombre laisse le titre respirer sans concurrence.
 * Et la capsule d'onglets, posée DANS la lumière plutôt qu'à côté, se met à
 * réfracter quelque chose — c'est tout l'intérêt d'avoir du verre.
 *
 * À ne pas retourner une troisième fois sans le regarder tourner.
 */

/** Le haut de l'écran s'enfonce, plus sombre que `colors.background`. */
export const FIELD_TOP = '#070C09';

/**
 * Le bas émet.
 *
 * Assombri depuis `#173420` après essai à l'écran : la course s'étend sur toute
 * la hauteur, donc c'est l'intensité du bout qui décide de la quantité de vert
 * perçue, pas la longueur du dégradé. Raccourcir la course avait été essayé
 * avant et donnait un lavis fade dans le dernier quart — voir `ScreenField`.
 *
 * Assez clair pour que le dégradé se voie, assez sombre pour que du blanc dessus
 * reste largement au-delà de 11:1.
 */
export const FIELD_BOTTOM = '#12291A';

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

const TOP = hex(FIELD_TOP);
const BOTTOM = hex(FIELD_BOTTOM);

/**
 * Couleur du champ à la position verticale `t` (0 en haut de l'écran, 1 en bas).
 *
 * Sert aux surfaces qui doivent s'accorder à ce qu'elles recouvrent plutôt que
 * de porter une couleur décidée d'avance.
 */
export function fieldTintAt(t: number, alpha = 1): string {
  const k = Math.min(1, Math.max(0, t));
  const [r, g, b] = TOP.map((c, i) => Math.round(c + (BOTTOM[i] - c) * k));
  return `rgba(${r},${g},${b},${alpha})`;
}
