// src/theme/elevation.ts

import { StyleSheet, ViewStyle } from 'react-native';
import { colors } from './colors';

/**
 * Élévation — une seule source de lumière, au-dessus et légèrement en avant.
 *
 * Trois conséquences, tenues partout sans exception :
 *
 *   1. l'ombre tombe VERS LE BAS. `height` positif, `width` toujours nul. Une
 *      ombre sans décalage n'est pas une ombre, c'est un halo posé autour d'un
 *      objet, et ça se lit comme de la décoration.
 *   2. le bord HAUT capte la lumière. Un filet blanc très faible, qui se
 *      renforce avec la hauteur.
 *   3. plus une surface est haute, plus elle est CLAIRE.
 *
 * Le point 3 fait le gros du travail ici, et c'est le point qui manquait. Sur
 * un fond à #0A120E, une ombre noire ne se voit pratiquement pas : la
 * profondeur d'une interface sombre se lit à la clarté des surfaces, pas à leur
 * ombre portée. L'ombre ne sert plus qu'aux éléments qui survolent réellement du
 * contenu, où elle sépare deux plans que la couleur seule ne séparerait pas.
 *
 * Avant ce fichier, l'app avait 11 `shadowRadius`, 14 `shadowOpacity` et 13
 * `elevation` indépendants les uns des autres. Deux `elevation` valaient 99 et
 * 100 : c'étaient des bricoles d'ordre d'affichage déguisées en profondeur.
 * Rien ne se tenait à une hauteur cohérente, d'où la lecture « tas de cartes »
 * plutôt que « espace ».
 */

/**
 * Les cinq propriétés d'ombre, et rien d'autre.
 *
 * Typer une ombre en `ViewStyle` la rendrait inapplicable à une `Image`, dont
 * le style refuse `overflow: 'scroll'`. Or une image se soulève exactement comme
 * une vue : le token décrit une hauteur, pas une sorte de nœud.
 */
type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  shadowOpacity: number;
  elevation: number;
};

type ElevationLevel = {
  /** Fond de la surface à cette hauteur. Plus haut, plus clair. */
  surface: string;
  /** Filet spéculaire du bord haut. À poser en `borderTopColor`. */
  hairline: string;
  /** Ombre portée, prête à étaler dans un style. */
  shadow: ShadowStyle;
};

/** `elevation` Android et ombre iOS décrivent la MÊME hauteur, donc ils sont
 *  écrits ensemble. Les séparer est exactement ce qui les a fait diverger. */
const shadow = (height: number, blur: number, opacity: number, android: number): ShadowStyle => ({
  shadowColor: '#000',
  shadowOffset: { width: 0, height },
  shadowRadius: blur,
  shadowOpacity: opacity,
  elevation: android,
});

export const elevation: Record<'flush' | 'resting' | 'raised' | 'floating', ElevationLevel> = {
  /** À même le fond. Séparateurs, zones neutres, listes nues. */
  flush: {
    surface: colors.background,
    hairline: 'transparent',
    shadow: shadow(0, 0, 0, 0),
  },

  /** Posé sur le fond. La carte ordinaire, la ligne de liste, le champ. */
  resting: {
    surface: colors.surface,
    hairline: 'rgba(255,255,255,0.06)',
    shadow: shadow(2, 6, 0.2, 2),
  },

  /** Détaché du fond. La carte qui porte le contenu principal de l'écran. */
  raised: {
    surface: colors.surfaceLight,
    hairline: 'rgba(255,255,255,0.10)',
    shadow: shadow(6, 14, 0.32, 6),
  },

  /**
   * Survole le contenu qui défile. Barre d'onglets, feuille modale, toast.
   *
   * Même teinte que `raised` : au-delà de #1A2920 la surface se met à concurrencer
   * le vert de marque. C'est l'ombre, pas la couleur, qui porte la différence
   * ici, et c'est légitime — un objet flottant est le seul cas où quelque chose
   * passe VRAIMENT devant autre chose.
   */
  floating: {
    surface: colors.surfaceLight,
    hairline: 'rgba(255,255,255,0.16)',
    shadow: shadow(12, 26, 0.48, 16),
  },
};

/**
 * Bordure haute éclairée d'une surface, à étaler dans un style.
 *
 * En bordure HAUTE seule, et pas sur les quatre côtés : un contour complet
 * dessine le périmètre d'une carte, un filet haut dessine la face qui prend la
 * lumière. Le premier est un trait, le second est un volume.
 */
export function litEdge(level: keyof typeof elevation): ViewStyle {
  return {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: elevation[level].hairline,
  };
}

/**
 * La seule lueur colorée que l'app s'autorise.
 *
 * Une ombre portée dit « cet objet est au-dessus d'un autre ». Une lueur sans
 * décalage dit « cet objet émet de la lumière ». La première est de la
 * profondeur, la seconde est un état. Tout le reste est de la décoration, et
 * c'est ce que l'œil identifie immédiatement comme une interface générée.
 *
 * Réservée à ce qui est réellement EN MARCHE : le scanner actif, la session en
 * ligne. Un bouton vert qui brille en vert parce qu'il est vert n'énonce aucun
 * état, il se répète. C'était le cas de huit des neuf ombres du Dashboard.
 */
export const liveGlow: ShadowStyle = {
  shadowColor: colors.primary,
  shadowOffset: { width: 0, height: 0 },
  shadowRadius: 12,
  shadowOpacity: 0.55,
  elevation: 8,
};
