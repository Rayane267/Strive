'use client';

import { useEffect, useState } from 'react';
import Logo from './Logo';

const links = [
  { href: '#features', label: 'Fonctions' },
  { href: '#how', label: 'Méthode' },
  { href: '#pricing', label: 'Tarifs' },
  { href: '#faq', label: 'FAQ' },
];

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-line bg-canvas/75 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
        <a href="#top" aria-label="Strive accueil">
          <Logo />
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:text-fg"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <a href="#pricing" className="btn btn-signal rounded-full px-5 py-2.5 text-sm">
            Télécharger
          </a>
        </div>

        <button
          aria-label="Menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-fg md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div className="border-t border-line bg-canvas/95 px-5 py-4 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 font-mono text-sm uppercase tracking-widest text-muted hover:bg-ink hover:text-fg"
              >
                {l.label}
              </a>
            ))}
            <a href="#pricing" onClick={() => setOpen(false)} className="btn btn-signal mt-2 rounded-full px-5 py-3 text-sm">
              Télécharger
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
