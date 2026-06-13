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
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
      <nav
        className={`mx-auto flex max-w-5xl items-center justify-between rounded-full px-3 py-2.5 pl-5 transition-all duration-500 ${
          scrolled ? 'nav-pill' : 'border border-transparent'
        }`}
      >
        <a href="#top" aria-label="Strive accueil" className="shrink-0">
          <Logo />
        </a>

        <div className="hidden items-center gap-0.5 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-fg"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href="#pricing"
            className="btn btn-signal shimmer rounded-full px-5 py-2.5 text-[13px]"
          >
            Télécharger
          </a>
        </div>

        <button
          aria-label="Menu"
          className="flex h-10 w-10 items-center justify-center rounded-full text-fg md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div className="nav-pill mx-auto mt-2 max-w-5xl rounded-3xl px-3 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-2xl px-4 py-3 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-fg"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#pricing"
              onClick={() => setOpen(false)}
              className="btn btn-signal mt-1 rounded-2xl px-5 py-3 text-sm"
            >
              Télécharger
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
