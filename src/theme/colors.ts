// src/theme/colors.ts
export const colors = {
  background: '#0A120E',
  surface: '#15241C',
  surfaceLight: '#1A2920',
  primary: '#00E676', // Ton vert fluo
  // Même teinte que `primary`, un cran plus sombre et légèrement désaturée.
  // Réservé aux grandes surfaces pleines répétées — les tuiles d'icônes du
  // Profil en alignent une quinzaine : à `primary` la colonne devenait un mur
  // fluo qui écrasait le texte des lignes. En accent ponctuel (badges, bordures,
  // liens) `primary` reste le bon ton.
  primarySoft: '#0FBD69',
  danger: '#FF4D4D',
  textMain: '#FFFFFF',
  textMuted: '#8F9B96',
  // #808892 : contraste ≥ 4.5:1 (WCAG AA texte normal) sur background ET surface.
  // L'ancien #6B7280 tombait à ~3.9:1 (échec AA) pour tout le texte secondaire.
  textDimmed: '#808892',
};
