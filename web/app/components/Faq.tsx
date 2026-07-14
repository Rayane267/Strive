'use client';

import { useState } from 'react';
import Reveal from './Reveal';

const faqs = [
  { q: 'Comment fonctionne le scanner ?', a: 'Capture l\'offre affichée dans ton app VTC, Strive en extrait le prix, la distance et le temps par OCR, puis affiche un verdict selon tes seuils minimum — en 2 secondes.' },
  { q: 'Strive marche avec quelles apps de course ?', a: 'Uber, Bolt, Heetch et les apps VTC qui affichent l\'offre à l\'écran. Strive scanne la capture pour en extraire les détails.' },
  { q: 'Comment est calculé mon €/h ?', a: 'Strive part du tarif, ajoute le temps d\'approche jusqu\'au client, et calcule le temps de trajet réel avec le trafic en temps réel. Tu obtiens ton €/h réel, pas une estimation à vol d\'oiseau.' },
  { q: 'Coût carburant et profit net ?', a: 'À partir de la conso de ton véhicule (L/100km, ou kWh/100km en électrique) et du prix du carburant, Strive déduit le coût de chaque course pour afficher ton profit net. En électrique, tu fixes ton propre prix au kWh.' },
  { q: 'C\'est quoi le score qualité ?', a: 'Un score sur 100 par course, en comparant ses €/h et €/km à tes seuils : vert au-dessus, orange proche, rouge en dessous. Tu vois aussi la qualité moyenne de tes courses acceptées dans les stats.' },
  { q: 'Combien de scans par jour ?', a: '3 scans par jour en gratuit, 15 par jour avec Strive Plus.' },
  { q: 'Comment fonctionne l\'essai gratuit de 7 jours ?', a: 'Les 7 premiers jours sont 100% gratuits. Annule à tout moment avant la fin de la période et tu ne seras pas facturé. Sinon, l\'abonnement se renouvelle automatiquement.' },
  { q: 'Puis-je annuler à tout moment ?', a: 'Oui, en 1 clic depuis les réglages de l\'App Store ou Google Play. Pas de question, pas de friction, pas d\'engagement.' },
  { q: 'Mes données sont-elles privées ?', a: 'Tout est chiffré et stocké de manière sécurisée. Aucune donnée vendue, aucune publicité, aucun tracking tiers. Tu peux supprimer ton compte à tout moment depuis l\'app.' },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="relative z-10 mx-auto max-w-7xl scroll-mt-28 px-5 py-32 sm:px-8">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <span className="eyebrow">05 — FAQ</span>
          <h2 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-[3.4rem]">
            Les questions<br />qui reviennent.
          </h2>
          <p className="mt-5 max-w-xs text-sm text-muted">
            Une autre question ? Écris-nous, on répond sous 24h.
          </p>
        </Reveal>

        <div className="glass rounded-3xl px-6 sm:px-8">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={f.q} delay={i * 50}>
                <div className={i === faqs.length - 1 ? '' : 'border-b border-line'}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="font-display text-lg font-semibold">{f.q}</span>
                    <span
                      className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border border-line text-signal transition-transform ${
                        isOpen ? 'rotate-45 border-signal/40' : ''
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                      </svg>
                    </span>
                  </button>
                  <div className="grid transition-all duration-300 ease-out" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}>
                    <div className="overflow-hidden">
                      <p className="pb-5 pr-10 text-sm leading-relaxed text-muted">{f.a}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
