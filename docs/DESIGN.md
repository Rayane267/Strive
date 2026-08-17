# Design System — Strive Airy Clean

Document de référence de l'identité visuelle. Il fait autorité : en cas d'écart entre le code
et ce document, c'est le code qui a tort.

L'ancien thème sombre (`#0A120E` / `#00E676`) est figé sur la branche `strive-vert` et le tag
`strive-vert-v1`. Il sert d'anti-référence, pas de base.

---

## 1. Vision

**« The Profitable Flow »** — transformer la complexité financière du VTC en une expérience
fluide, lumineuse et rassurante. Codes de la fintech premium et des applications iOS natives :
clarté maximale, grands espaces blancs, hiérarchie typographique forte.

## 2. Palette

| Rôle | Valeur | Usage |
|---|---|---|
| Surface Base | `#FFFFFF` | Fond principal |
| Surface Container | `#F8FAF9` | Cartes et sections, gris très léger nuancé émeraude |
| Brand Action | `#13EC80` | **Fond** des boutons principaux et indicateurs de gain |
| Brand Ink | `#006D37` | **Avant-plan** vert : texte et icônes (voir ci-dessous) |
| On-Surface | `#08110C` | Texte principal |
| On-Surface-Variant | `#6B7280` | Informations secondaires, légendes |
| Outline | `#E0E7E2` | Bordures fines, séparateurs |
| Error | `#BA1A1A` | Erreurs et actions destructrices |

### Pourquoi deux verts

`#13EC80` sur blanc donne **1,6:1** de contraste. Le minimum est de 4,5:1 pour du texte et
3:1 pour une icône. Le vert néon est donc réservé aux **fonds** — avec du texte noir dessus,
comme prévu — et aux teintes légères.

Dès que le vert devient du **texte ou une icône**, il passe sur `#006D37`, qui donne 5,6:1.
C'est la seule entorse au document d'origine, et elle est là pour que l'app reste lisible au
soleil, dans une voiture, ce qui est sa condition d'usage réelle.

## 3. Typographie

Police **système** : SF Pro sur iOS, Roboto sur Android. Le document d'origine demandait Inter
pour « imiter la précision de San Francisco » — sur iOS, on utilise donc directement
l'original, sans peser sur le binaire.

| Style | Taille | Graisse | Interlettrage |
|---|---|---|---|
| Display | 34 | 800 | -0.02em |
| Headline | 28 | 700 | -0.01em |
| Headline mobile | 24 | 700 | — |
| Body | 17 | 400-500 | — |
| Label | 13 | 600 | +0.01em |

- Titres en graisse lourde, interlettrage resserré : look éditorial et premium.
- Corps de texte en graisse normale, interligne généreux — les chiffres doivent se lire d'un
  coup d'œil, en conduite.
- Titres centrés à l'onboarding, alignés à gauche partout ailleurs.

## 4. Formes et profondeur

- **Arrondis** : 32 px sur les cartes et les boutons pleine largeur, 16 px sur les petits
  éléments. C'est ce qui enlève le côté clinique d'une app de données.
- **Ombres** : `0 10px 30px rgba(0,0,0,0.04)`. Diffuse, avec décalage vertical — jamais de
  halo coloré sans décalage, qui n'est que de la décoration.
- **Appui** : les cartes interactives se réduisent légèrement (0.98) plutôt que de changer de
  couleur. Réponse tactile, pas signal visuel.
- **Flou** : fond flouté léger sur les barres de navigation collantes, pour garder le contexte
  du contenu qui défile dessous.

## 5. Rythme

- Module de **8 px**.
- Marges de page : **24 px** minimum.
- Espacement entre blocs logiques : 32 à 48 px.
- Cibles tactiles : **56 px** minimum de hauteur.

## 6. Composants

- **Action principale** : pleine largeur, 56 px de haut, fond `#13EC80`, texte noir. Une seule
  par écran.
- **Action secondaire** : fond noir et texte blanc, ou bouton fantôme avec bordure `outline`
  de 1 px.
- **Cartes de sélection** : fond `#F8FAF9`, arrondi marqué. Sélectionnée, elle passe en aplat
  plein.
- **Champs de saisie** : fond gris très clair, sans bordure, arrondi 16 px. Texte indicatif
  nettement atténué.
- **Listes** : style « Réglages iOS » — séparateurs horizontaux qui ne vont pas jusqu'au bord,
  chevron à droite.
- **Progression** : barre fine horizontale en haut de l'écran.

## 7. Iconographie

Traits fins (2 px), icônes creuses. Noir en état neutre, `#006D37` en état actif ou pour un
succès financier.
