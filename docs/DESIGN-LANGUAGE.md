# Langue visuelle de Strive

Ce document existe pour une raison précise : deux rendus du **même écran** de
portefeuille, à composants et mise en page identiques, l'un étiqueté
« Claude Fable 5.1 » et l'autre « Design Agency ». C'est la comparaison la plus
propre dont on dispose, parce que le contenu est constant et que seul le
traitement change. Les images sont dans `D:\STRIVEPAPIER\` (hors dépôt) :
`HRMfjVhXUAEnD1t.jfif` (Fable) et `HRMfkufWEAE4KNx.jfif` (Agency).

**La version Agency est la référence.** C'est elle qui a une identité et qui se
lit comme une vraie application. La version Fable est plus contrastée et plus
nette, et c'est précisément ce qui la rend générique : elle a la forme de
n'importe quelle app fintech sombre.

Même famille que la vidéo d'app santé (`ssstwitter.com_1788479148590.mp4`, même
dossier), et même famille que le `.scrollEdgeEffectStyle(.soft)` d'iOS 26 :
bords doux, matériau translucide, lumière continue.

---

## A. Le champ lumineux

| | Fable | Agency | À faire dans Strive |
|---|---|---|---|
| A1 | Vert profond à peu près plat, plus une lueur radiale derrière le chiffre | **Un seul dégradé vertical continu**, gris-vert sombre en haut vers presque blanc en bas | `ScreenGradient` fait l'inverse : `#12291D` vers `#0A120E`, donc il s'assombrit, et il devient plat après 42 %. À inverser en un champ qui traverse tout l'écran. |
| A2 | Le fond est une toile sur laquelle des objets sont posés | **Le fond est un champ dans lequel les objets sont plongés**, et leur apparence change selon leur position dedans | Aucun composant de Strive ne lit sa position pour s'adapter. C'est le changement le plus structurel de la liste. |
| A3 | Lumière implicite venue d'en haut | **La surface elle-même émet**, plus claire vers le bas | `elevation.ts` encode aujourd'hui une lampe au-dessus. Le modèle reste juste pour les surfaces opaques, mais ce n'est pas celui du champ. |
| A4 | Touche le noir en haut ET le blanc en bas | Ne touche jamais le noir, monte jusqu'au presque blanc | Strive n'a **aucune surface claire** : tout vit entre `#0A120E` et `#1A2920`, plus le vert fluo. Il manque tout le haut de la gamme. |

## B. Le matériau des contrôles

| | Fable | Agency | À faire dans Strive |
|---|---|---|---|
| B1 | Pill de segments : fond sombre plein et trait vert clair de 1 px | **Panneau translucide givré et liseré lumineux diffus**, aucune ligne franche | Le vocabulaire existe déjà dans `TabNavigator` (BlurView, `shimmer` en dégradé, filet). Il ne sert nulle part ailleurs. |
| B2 | Pastille de devise : vert saturé plein | **Cercle translucide**, même matériau que son conteneur | Strive met du `colors.primary` plein partout. Le plein doit devenir l'exception. |
| B3 | Onglet non sélectionné : texte gris, icône en contour, **aucun conteneur** | Même chose, mais l'icône est une puce givrée, donc elle reste de la même famille | Ne pas faire disparaître le conteneur de l'état inactif : le garder dans le matériau et l'éteindre en intensité. |
| B4 | Cloche : cercle sombre et anneau net | Cercle givré et liseré doux | `headerBtn` du Dashboard est un cercle opaque. Candidat direct. |
| B5 | Quatre cercles d'action : fond translucide sombre, anneau net, icônes blanches à pleine intensité | **Verre givré, liseré doux, icônes dont le contraste baisse à mesure que le champ s'éclaircit** | Voir A2, c'est le même mécanisme. |
| B6 | Le bord est un trait | **Le bord est un dégradé d'intensité** | Le verre capte la lumière le long de sa courbe. `src/theme/stroke.ts` porte la règle : trait pour l'opaque, liseré en dégradé pour le verre, et ne jamais croiser les deux. |

## C. Typographie et contraste

| | Fable | Agency | À faire dans Strive |
|---|---|---|---|
| C1 | Chiffre très gras blanc, décimales en gris moyen | Chiffre plus léger, **décimales en gris pâle qui recule davantage** | La coupure entier/décimales est bonne dans les deux versions. À reprendre pour le gain du jour. |
| C2 | Libellés d'action en blanc medium | **Libellés en gris, qui s'estompent en descendant dans le champ** | Voir A2. |
| C3 | **Contraste maximal sur chaque élément** | **Contraste réservé au chiffre**, les contrôles reculent | C'est le mode d'échec de Strive : `#00E676` est utilisé partout. Quand tout est au maximum, plus rien ne mène. |

## D. Le panneau bas

| | Fable | Agency | À faire dans Strive |
|---|---|---|---|
| D1 | Rectangle **blanc opaque**, arête haute franche, ombre nette | **Panneau translucide givré**, même matériau que les contrôles, bord doux | Les cartes du Dashboard sont opaques (`#15241C`, `#1A2920`). C'est le gros du travail. |
| D2 | Un matériau étranger tombé sur le vert | **Garde l'écran comme un seul lieu** | Critère de test : cet élément pourrait-il exister tel quel sur un autre écran ? Si oui, il n'appartient pas au lieu. |
| D3 | Filet en pointillés entre libellé et total, contenu serré | Une ligne libellé/valeur, total centré, **pas de pointillés**, respiration plus large | Le pointillé « reçu » est un maniérisme. Ne pas le reprendre. |

## E. L'expression des états

| | Fable | Agency | À faire dans Strive |
|---|---|---|---|
| E1 | Points de page : l'actif devient une **pilule allongée** (changement de forme) | Tous les points identiques, l'actif se distingue par l'opacité | Ici c'est Fable qui a raison, et c'est à prendre : un changement de forme se lit mieux qu'un changement d'opacité. Les deux références ne s'accordent pas sur ce point. |
| E2 | Sélectionné = conteneur, remplissage saturé, trait | Sélectionné = conteneur, verre, liseré | Déjà fait sur la barre d'onglets, nom sur le seul onglet actif. À étendre au reste. |
| E3 | — | — | Strive avait huit lueurs vertes décoratives sur des contrôles dans le seul Dashboard, dont une à décalage `0,0` et rayon 30. Migrées. **Il en reste 21 ailleurs dans `src/`.** |

## F. Géométrie

| | Fable | Agency | À faire dans Strive |
|---|---|---|---|
| F1 | Rayons plus serrés | **Rayons plus larges et plus continus**, coins du panneau plus doux | `src/theme/radius.ts` plafonne à `lg: 22`. À relever si on va vers le verre. |
| F2 | Padding serré | **Padding généreux et régulier** | 27 valeurs de padding distinctes dans `src/`, aucune échelle. Fichier suivant à écrire. |

---

## Où en est Strive, mesuré

**Toute l'app est passée à la nouvelle direction.** 49 fichiers touchés.

⚠️ **Le sens du champ a été inversé en cours de route.** La première version
suivait A1 à la lettre et s'éclaircissait vers le bas. C'était une erreur de
transport : chez la référence, ce bas clair est un *panneau à texte sombre*.
Le champ va maintenant du **vert de marque en haut** (`#0E3A23`) au **presque
noir en bas** (`#060A08`), et `GlassSurface` a été inversé avec lui — une
surface haute capte désormais plus de lumière, pas moins. La ligne A1 du tableau
ci-dessus décrit donc la référence, pas Strive. Les trois raisons du basculement
sont dans `field.ts`.

**La règle des formes**, née de la référence Revolut : un **contrôle** est une
pilule (`radius.full`), une **surface** est une carte. Et si du verre double un
contrôle, il prend le même rayon, sinon le flou reste découpé en carte sous une
pilule.

| | État | Reste |
|---|---|---|
| Champ lumineux | `field.ts` + `ScreenField`, monté sur les 4 écrans. `ScreenGradient`, qui s'assombrissait vers le bas, est supprimé | Les écrans secondaires |
| Matériau | `GlassSurface` : flou iOS, voile translucide Android, liseré en dégradé. 8 surfaces converties — 4 cartes du Dashboard, `slotsCard` et `distCard` d'Analytics, `earnCard` et le **groupe d'options** du Profil | Les modales, `upgradeCard`, les écrans secondaires |
| Position dans le champ | Le voile de chaque surface interpole sur le `scrollY` de son écran, en `useNativeDriver`. Une carte s'éclaircit en descendant | — |
| Rayons | 76 migrés sur les 3 écrans, plus 31 sur le Dashboard | **33 valeurs distinctes** dans les écrans secondaires et les composants |
| Élévation | 9 blocs migrés, dont 3 lueurs vertes en `Platform.select` dans le Profil | Écrans secondaires |
| Bords | 46 `borderColor` et 40 `borderWidth` migrés. Un bord vert reste vert seulement si le nom du style désigne un état | Écrans secondaires |
| Contraste | 11 icônes décoratives neutralisées sur les 3 écrans, plus 7 sur le Dashboard, plus l'orbe radiale supprimée | Écrans secondaires |
| Lueurs colorées | **0 dans les 4 écrans** | 17 ailleurs |
| Espacement | `spacing.ts` appliqué aux 4 écrans : **176 paddings et 116 marges** migrés, 27 valeurs distinctes ramenées à 8 crans. Deux crans ajoutés après coup parce que rabattre dégradait : `tight` (2) pour l'espace entre deux lignes d'un même propos, `xxxl` (48) pour les états vides | Écrans secondaires |
| Chorégraphie | `motion.ts` + `AnimatedEntrance` qui accepte un rang et un élément focal, et respecte enfin « mouvement réduit ». Les 5 retards arbitraires d'Analytics (0, 100, 150, 175, 185 ms) sont devenus des rangs, ordre préservé | History, et le choix du focal sur chaque écran |

### État chiffré, toute l'app

| | Couverture |
|---|---|
| Champ monté | **20 écrans sur 21** |
| Surfaces de verre | **37**, réparties sur 10 écrans |
| Entrées chorégraphiées | 11 écrans |
| Rayons bruts distincts restants | **3** (tous dans `src/navigation/`) |
| Espacements bruts restants | **8** (6 dans `src/navigation/`, 1 calage optique, 1 commentaire) |
| Lueurs colorées restantes | **8** (dont 2 légitimes : `liveGlow` et l'indicateur d'onglet) |

### Décisions assumées

- **Les lignes de liste restent opaques.** Historique et tickets de support. Un
  `BlurView` par ligne dans une liste qui défile coûte autant que la liste. Le
  groupe d'options du Profil fait l'inverse et c'est cohérent : **une** surface
  de verre pour tout le groupe, pas une par ligne.
- **`WelcomeGiftScreen` garde son fond.** C'est un dégradé pré-tramé en image, et
  la raison est documentée dans le fichier : un dégradé calculé sur un fond quasi
  noir y produisait des barres horizontales visibles. Le champ l'aurait ramené.
- **`packCard` de la Boutique garde `overflow: 'visible'`.** Son badge « meilleur
  prix » est posé à `top: -10` et doit déborder. Le verre se découpe sur son
  propre rayon, donc les deux cohabitent.
- **Onboarding et Tutorial n'ont pas reçu d'entrée d'en-tête.** Ils portent déjà
  leur propre chorégraphie, et deux entrées superposées se contrarient.

## Ordre de travail

1. **Appliquer `spacing.ts`.** Le fichier existe, aucun écran ne le consomme.
   Dernière famille de tokens à brancher, et celle qui change la respiration.
2. **Choisir le focal de chaque écran.** Le Dashboard a le sien (la rangée de
   gains). Les trois autres entrent encore à plat.
3. **Le chiffre héros** (C1). La coupure entier/décimales sur le gain du jour,
   seul geste des deux références qu'on n'ait pas encore repris.
4. **Les écrans secondaires**, s'ils le méritent.
