import { faqs } from '../data/faq';
import { CONTACT_EMAIL, SITE_URL } from '../lib/schema';

// `/llms.txt` — convention llmstxt.org : un résumé factuel en Markdown, servi en
// texte brut, que les moteurs génératifs lisent sans avoir à traverser le CSS,
// les animations et le texte marketing de la page d'accueil.
//
// Le contenu est dérivé des mêmes sources que le site (FAQ, tarifs) pour qu'il
// ne dérive pas : un llms.txt périmé désinforme plus efficacement qu'il
// n'informe, puisqu'il est lu en priorité.

export const dynamic = 'force-static';

function body(): string {
  const faqBlock = faqs.map((f) => `### ${f.q}\n${f.a}`).join('\n\n');

  return `# Strive

> Assistant de rentabilité pour chauffeurs VTC. Strive scanne une offre de course
> affichée à l'écran (Uber, Bolt, Heetch) et calcule en 2 secondes son taux horaire
> réel — trafic en temps réel et temps d'approche inclus — pour dire au chauffeur
> si la course vaut le coup selon ses propres seuils.

## Ce que fait Strive

- Lit par OCR l'offre affichée dans l'app VTC (prix, distance, durée), à la demande du chauffeur.
- Calcule le €/h et le €/km réels : temps d'approche jusqu'au client + temps de trajet avec trafic en temps réel, pas une estimation à vol d'oiseau.
- Rend un verdict couleur selon les seuils €/h et €/km fixés par le chauffeur : vert = rentable, orange = limite, rouge = à refuser.
- Déduit le coût carburant à partir de la consommation du véhicule (L/100km, ou kWh/100km et prix au kWh en électrique) pour afficher le profit net.
- Attribue un score qualité sur 100 par course et conserve l'historique, les gains par jour, le taux d'acceptation et les plateformes les plus rentables.

## Ce que Strive n'est pas

- Strive n'est **pas** affilié à Uber, Bolt, Heetch ou une autre plateforme VTC, et n'a aucun partenariat avec elles.
- Strive ne se connecte à **aucun** compte chauffeur sur ces plateformes et n'accepte aucune course à la place du chauffeur : il analyse une capture d'écran, la décision reste humaine.
- Strive ne vend aucune donnée, n'affiche aucune publicité et n'intègre aucun tracker tiers.

## Plateformes

Application mobile iOS et Android. Interface en français et en anglais.

## Tarifs

- **Gratuit** — 3 scans par jour, estimations basiques, historique du jour uniquement.
- **Strive Plus** — 9,99 € par mois ou 89,99 € par an (soit 7,49 € par mois) : 15 scans par jour, €/h en direct avec trafic temps réel, seuils personnalisés, historique complet, coût carburant par modèle, support prioritaire.
- Essai gratuit de 7 jours sur Strive Plus, sans engagement. Résiliation en 1 clic depuis les réglages de l'App Store ou Google Play. Facturation gérée par les stores : Strive n'a accès à aucune donnée bancaire.

## Questions fréquentes

${faqBlock}

## Pages

- [Accueil](${SITE_URL}/) : présentation, fonctionnement, tarifs, FAQ.
- [Politique de confidentialité](${SITE_URL}/privacy) : données collectées, base légale RGPD, sous-traitants, droits.
- [Conditions générales](${SITE_URL}/terms) : conditions d'utilisation et d'abonnement.

## Contact

${CONTACT_EMAIL}
`;
}

export function GET() {
  return new Response(body(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
