'use client';

import { useState } from 'react';
import Reveal from './Reveal';
import { COMPARISON, PLANS, PREMIUM_LIVE, type Cycle } from '../data/plans';

export default function Pricing() {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const yearly = cycle === 'yearly';

  return (
    <section id="pricing" className="relative z-10 mx-auto max-w-7xl scroll-mt-28 px-5 py-32 sm:px-8">
      <Reveal>
        <span className="eyebrow">04 — Tarifs</span>
        <h2 className="mt-5 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-[3.4rem]">
          Gratuit pour commencer. <span className="text-muted">Plus quand tu veux plus.</span>
        </h2>
      </Reveal>

      {/* Sélecteur de cycle — le seul moment animé de la section */}
      <Reveal delay={80} className="mt-10 flex flex-wrap items-center gap-3">
        <div className="relative grid w-[17rem] grid-cols-2 rounded-full border border-line bg-ink-2/60 p-1">
          <span
            aria-hidden
            className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              yearly ? 'translate-x-full' : ''
            }`}
          />
          {(['monthly', 'yearly'] as Cycle[]).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              aria-pressed={cycle === c}
              className={`relative z-10 rounded-full py-2.5 text-sm font-semibold transition-colors ${
                cycle === c ? 'text-fg' : 'text-faint hover:text-muted'
              }`}
            >
              {c === 'monthly' ? 'Mensuel' : 'Annuel'}
            </button>
          ))}
        </div>
        <span className="rounded-full border border-amber/40 bg-amber/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-amber">
          3 mois offerts
        </span>
      </Reveal>

      {/* Paliers */}
      <div className={`mt-12 grid gap-5 md:items-stretch ${PREMIUM_LIVE ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {PLANS.map((plan, i) => (
          <Reveal
            key={plan.id}
            delay={i * 90}
            className={`h-full ${plan.featured ? 'order-first md:order-none' : ''}`}
          >
            <div
              className={`relative flex h-full flex-col rounded-3xl p-8 ${
                plan.featured ? 'glass ring-signal' : 'glass-soft card-rise'
              }`}
            >
              {plan.tag && (
                <span
                  className={`absolute right-8 top-8 rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                    plan.featured
                      ? 'bg-signal text-[#05140c]'
                      : 'border border-signal/25 bg-signal/10 text-signal'
                  }`}
                >
                  {plan.tag}
                </span>
              )}

              <h3 className={`font-display text-lg font-bold ${plan.featured ? 'text-signal' : ''}`}>
                {plan.name}
              </h3>
              <p className="mt-1 max-w-[15rem] text-sm text-muted">{plan.tagline}</p>

              <div className="mt-7 flex items-baseline gap-1.5">
                <span className="font-display text-5xl font-extrabold tracking-[-0.03em]">
                  {plan.price[cycle]}
                </span>
                <span className="text-muted">{plan.suffix[cycle]}</span>
              </div>
              <p className="mt-1.5 font-mono text-[11px] uppercase tracking-widest text-faint">
                {plan.note[cycle]}
              </p>

              <ul className="mt-8 flex-1 space-y-3.5">
                {plan.points.map((p) => (
                  <li
                    key={p}
                    className={`flex items-start gap-3 text-sm ${
                      plan.id === 'free' ? 'text-muted' : 'text-fg'
                    }`}
                  >
                    <Check muted={plan.id === 'free'} /> {p}
                  </li>
                ))}
              </ul>

              <a
                href="#download"
                className={`btn mt-8 rounded-full py-3 text-sm ${
                  plan.featured ? 'btn-signal shimmer' : 'btn-ghost'
                }`}
              >
                {plan.cta}
              </a>
              {plan.footnote && (
                <p className="mt-3 text-center text-[11px] leading-relaxed text-faint">
                  {plan.footnote[cycle]}
                </p>
              )}
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <p className="mt-8 text-center text-sm text-faint">
          Annulable en 1 clic depuis l&apos;App Store ou Google Play · Aucun engagement · Aucune donnée revendue
        </p>
      </Reveal>

      {/* Comparatif — le détail pour ceux qui hésitent encore */}
      <Reveal delay={160} className="mt-20">
        <h3 className="font-display text-xl font-bold tracking-[-0.02em]">Le détail, ligne par ligne</h3>
        <div className="mt-6 -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="w-2/5 pb-4 font-mono text-[11px] font-medium uppercase tracking-widest text-faint">
                  &nbsp;
                </th>
                <th className="pb-4 font-mono text-[11px] font-bold uppercase tracking-widest text-faint">
                  Gratuit
                </th>
                <th className="pb-4 font-mono text-[11px] font-bold uppercase tracking-widest text-signal">
                  Plus
                </th>
                {PREMIUM_LIVE && (
                  <th className="pb-4 font-mono text-[11px] font-bold uppercase tracking-widest text-fg">
                    Premium
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-t border-line">
                  <th scope="row" className="py-4 pr-4 text-left font-normal text-muted">
                    {row.label}
                  </th>
                  <td className="py-4 pr-4 text-faint">{row.free}</td>
                  <td className="py-4 pr-4 font-semibold text-signal">{row.plus}</td>
                  {PREMIUM_LIVE && <td className="py-4 font-semibold text-fg">{row.premium}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
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
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
        <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
