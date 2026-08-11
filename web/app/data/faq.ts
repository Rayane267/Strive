// Source unique des questions/réponses : la section FAQ visible ET le balisage
// FAQPage lisent ce tableau. Deux copies divergeraient, et un schema qui ne
// correspond pas au contenu affiché est traité comme du balisage trompeur.

export type FaqItem = { q: string; a: string };

export const faqs: FaqItem[] = [
  {
    q: 'Comment fonctionne le scanner ?',
    a: "Capture l'offre affichée dans ton app VTC, Strive en extrait le prix, la distance et le temps par OCR, puis affiche un verdict selon tes seuils minimum — en 2 secondes.",
  },
  {
    q: 'Strive marche avec quelles apps de course ?',
    a: "Uber, Bolt, Heetch et les apps VTC qui affichent l'offre à l'écran. Strive scanne la capture pour en extraire les détails.",
  },
  {
    q: 'Comment est calculé mon €/h ?',
    a: "Strive part du tarif, ajoute le temps d'approche jusqu'au client, et calcule le temps de trajet réel avec le trafic en temps réel. Tu obtiens ton €/h réel, pas une estimation à vol d'oiseau.",
  },
  {
    q: 'Coût carburant et profit net ?',
    a: "À partir de la conso de ton véhicule (L/100km, ou kWh/100km en électrique) et du prix du carburant, Strive déduit le coût de chaque course pour afficher ton profit net. En électrique, tu fixes ton propre prix au kWh.",
  },
  {
    q: "C'est quoi le score qualité ?",
    a: "Un score sur 100 par course, en comparant ses €/h et €/km à tes seuils : vert au-dessus, orange proche, rouge en dessous. Tu vois aussi la qualité moyenne de tes courses acceptées dans les stats.",
  },
  {
    q: 'Combien de scans par jour ?',
    a: '3 scans par jour en gratuit, 15 par jour avec Strive Plus.',
  },
  {
    q: "Comment fonctionne l'essai gratuit de 7 jours ?",
    a: "Les 7 premiers jours sont 100% gratuits. Annule à tout moment avant la fin de la période et tu ne seras pas facturé. Sinon, l'abonnement se renouvelle automatiquement.",
  },
  {
    q: 'Puis-je annuler à tout moment ?',
    a: "Oui, en 1 clic depuis les réglages de l'App Store ou Google Play. Pas de question, pas de friction, pas d'engagement.",
  },
  {
    q: 'Mes données sont-elles privées ?',
    a: "Tout est chiffré et stocké de manière sécurisée. Aucune donnée vendue, aucune publicité, aucun tracking tiers. Tu peux supprimer ton compte à tout moment depuis l'app.",
  },
];
