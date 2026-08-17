// src/theme/type.ts
//
// Échelle typographique « Airy Clean » — voir docs/DESIGN.md.
//
// Regroupée ici plutôt que répétée dans 35 fichiers : c'est ce qui garantit que
// deux titres du même niveau ont la même taille d'un écran à l'autre.
//
// Police système volontairement : SF Pro sur iOS, Roboto sur Android. Le document
// demandait Inter « pour imiter la précision de San Francisco » — sur iOS on
// utilise donc l'original, sans alourdir le binaire ni imposer un rebuild natif.
import type { TextStyle } from 'react-native';

export const type = {
  /** Chiffre ou titre d'écran qui doit se lire d'un coup d'œil. */
  display: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 41,
    letterSpacing: -0.7,
  },
  headline: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  headlineMobile: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  /** Corps de texte : interligne généreux, la lecture se fait souvent à l'arrêt. */
  body: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyStrong: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
  },
  /** Libellés de navigation et petits indicateurs d'état. */
  label: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    letterSpacing: 0.1,
  },
} satisfies Record<string, TextStyle>;

/** Module de 8 px et marges de page, pour éviter les valeurs inventées au cas par cas. */
export const space = {
  page: 24,
  gutter: 16,
  card: 24,
  /** Hauteur minimale d'un élément interactif. */
  touch: 56,
} as const;

/** Arrondis : 32 sur les cartes et boutons pleine largeur, 16 sur le reste. */
export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  full: 9999,
} as const;
