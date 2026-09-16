/**
 * Fiches store officielles de l'application.
 *
 * Tant qu'une URL vaut `null`, le badge correspondant s'affiche en « Bientôt
 * sur … » et n'est pas cliquable — plutôt qu'un lien mort `href="#"` qui casse
 * le CTA principal du site. Il suffit de renseigner l'URL ici pour réactiver
 * le lien partout (hero + CTA final).
 */
export const STORE_LINKS: Record<'apple' | 'google', string | null> = {
  apple: null,
  google: null,
};
