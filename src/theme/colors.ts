// src/theme/colors.ts
//
// Palette « Airy Clean » — voir docs/DESIGN.md, qui fait autorité.
//
// Les noms de clés sont hérités du thème sombre : `background`, `surface`,
// `textMain`… Ils sont conservés tels quels parce que 816 usages en dépendent,
// et parce qu'ils décrivent un rôle, pas une couleur. Seules les valeurs changent.
export const colors = {
  background: '#FFFFFF',
  // Gris très léger, nuancé émeraude : sépare les sections sans ajouter de poids
  // visuel, là où une bordure en aurait ajouté.
  surface: '#F8FAF9',
  // Les cartes sont blanches et posées SUR `surface` — l'inverse du thème sombre,
  // où les surfaces s'éclaircissaient en montant.
  surfaceLight: '#FFFFFF',

  // Vert de marque, uniquement en FOND, avec du texte sombre dessus.
  //
  // Repris de la teinte du logo (#1C2E24, soit 150°) remontée en saturation.
  // Le logo lui-même est trop sombre et trop désaturé pour servir d'aplat : il
  // virerait au charbon. Le néon d'origine (#13EC80) était à l'inverse trop
  // clair pour porter la marque.
  //
  // #00B159 donne 6,8:1 avec le texte sombre — confortable. Descendre plus bas
  // ferait basculer vers du texte blanc, et primary rejoindrait primaryInk :
  // la distinction entre le fond et l'avant-plan disparaîtrait.
  primary: '#00B159',

  // Vert vif, réservé à l'action prioritaire d'un écran — une seule par écran.
  // C'est le « Brand Action » du document. Sa vivacité ne vaut que par sa
  // rareté : posé partout, il cesserait de désigner quoi que ce soit et
  // ramènerait le problème que `primary` vient de régler.
  // 12,2:1 avec le texte sombre, donc lisible sans réserve.
  accent: '#13EC80',
  // Vert d'avant-plan : dès que le vert devient du texte ou une icône.
  // #13EC80 sur blanc plafonne à 1,6:1, très en dessous des 4,5:1 exigés pour du
  // texte et des 3:1 pour une icône. #006D37 donne 5,6:1 et reste lisible en plein
  // soleil, ce qui est la condition d'usage réelle de l'app.
  primaryInk: '#006D37',

  danger: '#BA1A1A',

  textMain: '#08110C',
  textMuted: '#6B7280',
  // Même valeur que `textMuted` : sur blanc, descendre plus clair ferait passer le
  // texte secondaire sous le seuil AA. La hiérarchie se fait désormais par la
  // taille et la graisse, plus par des gris successifs.
  textDimmed: '#6B7280',

  // Séparateurs et bordures fines.
  outline: '#E0E7E2',
};

/**
 * Ombre unique du système : diffuse et décalée vers le bas, pour que les cartes
 * paraissent posées sur la surface plutôt que collées. Un halo sans décalage
 * n'est que de la décoration.
 */
export const shadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.04,
  shadowRadius: 30,
  elevation: 3,
} as const;
