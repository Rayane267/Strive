import Link from 'next/link';
import type { Metadata } from 'next';
import Logo from './components/Logo';

export const metadata: Metadata = {
  title: 'Page introuvable — Strive',
  description: 'Cette page n\'existe pas ou a été déplacée.',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="hero-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 text-center">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-20" />

      <div className="relative z-10 flex flex-col items-center">
        <Link href="/" aria-label="Strive accueil">
          <Logo />
        </Link>

        <p className="eyebrow mt-12">Erreur 404</p>

        <h1 className="mt-5 max-w-lg font-display text-[3rem] font-extrabold leading-[0.95] tracking-[-0.025em] sm:text-[4.5rem]">
          Mauvaise{' '}
          <span className="font-serif font-normal italic text-signal text-signal-glow">adresse.</span>
        </h1>

        <p className="mt-6 max-w-sm text-base leading-relaxed text-muted">
          Cette page n&apos;existe pas ou a été déplacée. Aucun détour rentable par ici.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link href="/" className="btn btn-signal shimmer rounded-full px-6 py-3 text-sm">
            Retour à l&apos;accueil
          </Link>
          <Link href="/#faq" className="btn btn-ghost rounded-full px-6 py-3 text-sm">
            Consulter la FAQ
          </Link>
        </div>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-widest text-faint">
          Un lien cassé ?{' '}
          <a href="mailto:contact@striveapp.fr" className="text-signal hover:underline">
            Signale-le
          </a>
        </p>
      </div>
    </main>
  );
}
