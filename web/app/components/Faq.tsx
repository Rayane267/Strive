'use client';

import { useState } from 'react';
import Reveal from './Reveal';
import { faqs } from '../data/faq';

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
