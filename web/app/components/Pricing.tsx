'use client';

import { useState } from 'react';
import Reveal from './Reveal';

const plusFeatures = [
  'Scans illimités',
  'Taux horaire €/h en direct',
  'Filtre intelligent des courses',
  'Seuils €/h et €/km personnalisés',
  'Historique complet des courses',
  'Coût carburant par modèle',
  'Dashboard complet',
  'Support prioritaire',
];

const freeFeatures = [
  '1 scan par jour',
  'Estimations basiques',
  'Dashboard basique',
  'Historique du jour seulement',
];

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  const price = yearly ? '79,99 €' : '9,99 €';
  const cycle = yearly ? '/an' : '/mois';
  const equiv = yearly ? 'soit 6,66 € / mois' : 'Sans engagement';

  return (
    <section id="pricing" className="relative z-10 mx-auto max-w-7xl scroll-mt-28 px-5 py-32 sm:px-8">
      <Reveal>
        <span className="eyebrow">04 — Tarifs</span>
        <h2 className="mt-5 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-[3.4rem]">
          Gratuit pour commencer. <span className="text-muted">Plus quand tu veux plus.</span>
        </h2>
      </Reveal>

      {/* Toggle */}
      <Reveal delay={80} className="mt-8 flex items-center gap-3">
        <span className={`font-mono text-xs uppercase tracking-widest ${!yearly ? 'text-fg' : 'text-faint'}`}>
          Mensuel
        </span>
        <button
          onClick={() => setYearly((v) => !v)}
          className="relative h-7 w-14 rounded-full border border-line bg-ink-2 transition-colors"
          aria-label="Basculer mensuel / annuel"
        >
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-signal transition-all ${
              yearly ? 'left-8' : 'left-1'
            }`}
          />
        </button>
        <span className={`font-mono text-xs uppercase tracking-widest ${yearly ? 'text-fg' : 'text-faint'}`}>
          Annuel
        </span>
        <span className="rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-amber">
          −33%
        </span>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-2 md:items-stretch">
        {/* Free */}
        <Reveal className="h-full">
          <div className="glass card-rise flex h-full flex-col rounded-3xl p-9">
            <h3 className="font-display text-lg font-bold">Gratuit</h3>
            <p className="mt-1 text-sm text-muted">Pour tester Strive</p>
            <div className="mt-6 flex items-baseline gap-1.5">
              <span className="font-display text-5xl font-extrabold">0 €</span>
              <span className="text-muted">/mois</span>
            </div>
            <ul className="mt-8 flex-1 space-y-3.5">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-muted">
                  <Check muted /> {f}
                </li>
              ))}
            </ul>
            <a href="#download" className="btn btn-ghost mt-8 rounded-full py-3 text-sm">
              Télécharger gratuitement
            </a>
          </div>
        </Reveal>

        {/* Plus */}
        <Reveal delay={100} className="h-full">
          <div className="glass ring-signal relative flex h-full flex-col rounded-3xl p-9">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/60 to-transparent" />
            <span className="absolute right-9 top-9 rounded-full bg-signal px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#05140c]">
              Populaire
            </span>
            <h3 className="font-display text-lg font-bold text-signal">Strive Plus</h3>
            <p className="mt-1 text-sm text-muted">Pour maximiser tes gains</p>
            <div className="mt-6 flex items-baseline gap-1.5">
              <span className="font-display text-5xl font-extrabold">{price}</span>
              <span className="text-muted">{cycle}</span>
            </div>
            <p className="mt-1 font-mono text-xs uppercase tracking-widest text-amber">{equiv}</p>
            <ul className="mt-8 flex-1 space-y-3.5">
              {plusFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-fg">
                  <Check /> {f}
                </li>
              ))}
            </ul>
            <a href="#download" className="btn btn-signal shimmer mt-8 rounded-full py-3 text-sm">
              Commencer mes 3 jours gratuits
            </a>
            <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-widest text-faint">
              Puis {price}{cycle} · Annulable
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Check({ muted = false }: { muted?: boolean }) {
  return (
    <span
      className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${
        muted ? 'bg-fg/8 text-faint' : 'bg-signal/20 text-signal'
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
