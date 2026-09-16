// src/theme/motion.ts

/**
 * Chorégraphie d'entrée.
 *
 * La leçon vient du podium de la vidéo de référence, décomposée image par image :
 * les blocs 2 et 3 montent en premier, le bloc 1 monte EN DERNIER et parcourt la
 * plus grande distance, le trophée se pose après tout le monde, et la liste des
 * rangs suivants n'arrive qu'une fois le podium terminé.
 *
 * Autrement dit le classement est raconté par le minutage. Ce n'est pas de
 * l'ornement ajouté après coup sur une liste, c'est la hiérarchie du contenu
 * exprimée dans le temps. Une entrée générée met le même fondu de 300 ms sur
 * tout et ne dit rien.
 *
 * Deux conséquences encodées ici :
 *
 *   1. le retard suit le RANG dans la hiérarchie, pas l'ordre dans le fichier ;
 *   2. l'élément le plus important arrive en dernier et vient de plus loin.
 */

/** Décalage entre deux rangs successifs. */
export const STAGGER = 55;

/** Distance parcourue par un élément ordinaire. */
export const TRAVEL = 20;

/**
 * Distance parcourue par l'élément focal.
 *
 * Plus longue, donc plus lente à parcourir à ressort égal : il arrive après les
 * autres même à retard identique, et c'est le mouvement lui-même qui désigne
 * l'important.
 */
export const TRAVEL_FOCAL = 34;

/** Retard d'un élément de rang `step`, décalé d'un cran s'il est focal. */
export function entranceDelay(step: number, focal = false): number {
  return Math.max(0, step + (focal ? 1 : 0)) * STAGGER;
}
