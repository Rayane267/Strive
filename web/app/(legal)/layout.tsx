import Link from 'next/link';
import Logo from '../components/Logo';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="aurora min-h-screen">
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
        <article className="mt-10 space-y-4 text-muted [&_a]:text-signal [&_h1]:font-display [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:text-fg [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg">
          {children}
        </article>
        <Link href="/" className="mt-12 inline-block font-mono text-xs uppercase tracking-widest text-signal hover:underline">
          ← Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
