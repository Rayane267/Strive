'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Trace côté navigateur ; le digest permet de retrouver la stack serveur.
    console.error(error);
  }, [error]);

  return (
    <main className="hero-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 text-center">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-20" />

      <div className="relative z-10 flex flex-col items-center">
        <p className="eyebrow">Erreur</p>

        <h1 className="mt-5 max-w-lg font-display text-[2.5rem] font-extrabold leading-[0.95] tracking-[-0.025em] sm:text-[3.6rem]">
          Panne{' '}
          <span className="font-serif font-normal italic text-signal text-signal-glow">passagère.</span>
        </h1>

        <p className="mt-6 max-w-sm text-base leading-relaxed text-muted">
          Une erreur inattendue s&apos;est produite de notre côté. Réessaie dans un instant.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <button onClick={reset} className="btn btn-signal shimmer rounded-full px-6 py-3 text-sm">
            Réessayer
          </button>
          <Link href="/" className="btn btn-ghost rounded-full px-6 py-3 text-sm">
            Retour à l&apos;accueil
          </Link>
        </div>

        {error.digest && (
          <p className="mt-10 font-mono text-[11px] uppercase tracking-widest text-faint">
            Référence : {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
