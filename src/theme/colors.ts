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
  /// Encre des elements poses SUR un aplat vert : texte et icones des boutons
  /// pleins, coches des listes d'avantages.
  ///
  /// Un vert tres sombre, et non `background` : ce dernier (#0A120E) est presque
  /// neutre et se lit comme du noir pose sur la couleur de marque. #062318 garde
  /// la teinte, ce qui adoucit le contact — c'est deja ce qu'utilisaient le CTA
  /// du paywall et les coches, les deux endroits ou le contact vert/encre etait
  /// juge reussi. Le blanc n'est pas une option : sur #00E676 il tombe autour de
  /// 1,7:1, largement sous le seuil lisible.
  onPrimary: '#062318',
  danger: '#FF4D4D',
  textMain: '#FFFFFF',
  textMuted: '#8F9B96',
  // #808892 : contraste ≥ 4.5:1 (WCAG AA texte normal) sur background ET surface.
  // L'ancien #6B7280 tombait à ~3.9:1 (échec AA) pour tout le texte secondaire.
  textDimmed: '#808892',
};
