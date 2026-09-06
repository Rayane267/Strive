import type { Metadata } from 'next';
import Logo from '../components/Logo';
import Countdown from './Countdown';
import WaitlistForm from './WaitlistForm';

// Date d'ouverture : surchargeable sans redéploiement de code via l'env Vercel
// NEXT_PUBLIC_LAUNCH_DATE (format ISO 8601 avec fuseau).
const LAUNCH_DATE = process.env.NEXT_PUBLIC_LAUNCH_DATE || '2026-10-01T09:00:00+02:00';

export const metadata: Metadata = {
  title: 'Strive — Liste d\'attente',
  description:
    'Strive arrive bientôt. Inscris-toi pour être prévenu à l\'ouverture et obtenir un accès prioritaire.',
  alternates: { canonical: '/waitlist' },
  openGraph: {
    title: 'Strive — Liste d\'attente',
    description: 'Strive arrive bientôt. Rejoins la liste d\'attente pour un accès prioritaire.',
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Strive',
  },
};

const SOCIALS = [
  {
    label: 'X',
    href: 'https://x.com/striveapp_fr',
    path: 'M17.53 3h3.05l-6.66 7.61L21.75 21h-5.9l-4.62-6.04L5.94 21H2.89l7.12-8.14L2.25 3h6.05l4.18 5.52L17.53 3zm-1.07 16.15h1.69L7.62 4.75H5.81l10.65 14.4z',
  },
  {
    label: 'Instagram',
    href: 'https://instagram.com/striveapp.fr',
    path: 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 6.68a3.16 3.16 0 100 6.32 3.16 3.16 0 000-6.32zm0-1.98a5.14 5.14 0 110 10.28 5.14 5.14 0 010-10.28zm6.54-.23a1.2 1.2 0 11-2.4 0 1.2 1.2 0 012.4 0z',
  },
];

export default function WaitlistPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="aurora-mesh" />
      <div className="hero-bg absolute inset-0 -z-10" />
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-20" />

      <header className="relative z-10 flex justify-center px-5 pt-8">
        <a href="/" aria-label="Accueil Strive">
          <Logo />
        </a>
      </header>

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-14 text-center sm:py-20">
        <div className="load-up" style={{ animationDelay: '40ms' }}>
          <span className="glass inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-[12px] tracking-wide text-muted">
            <span className="live-dot" />
            <span className="text-fg">Liste d&apos;attente</span>
          </span>
        </div>

        <h1
          className="load-up mt-7 font-display text-[3.2rem] font-extrabold leading-[0.92] tracking-[-0.03em] sm:text-[6rem]"
          style={{ animationDelay: '140ms' }}
        >
          Bientôt{' '}
          <span className="font-serif font-normal italic text-signal text-signal-glow">là.</span>
        </h1>

        <p
          className="load-up mt-5 max-w-md text-sm leading-relaxed text-muted sm:text-base"
          style={{ animationDelay: '200ms' }}
        >
          L&apos;instrument des chauffeurs VTC ouvre bientôt. Les inscrits passent en premier.
        </p>

        <div className="load-up mt-11" style={{ animationDelay: '300ms' }}>
          <Countdown target={LAUNCH_DATE} />
        </div>

        <div
          className="load-up glass ring-signal mt-12 w-full max-w-md rounded-[2rem] p-7 sm:p-9"
          style={{ animationDelay: '400ms' }}
        >
          <WaitlistForm />
        </div>

        <div className="load-up mt-12 flex items-center gap-3" style={{ animationDelay: '520ms' }}>
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={s.label}
              className="store-badge glass flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:text-signal"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <path d={s.path} />
              </svg>
            </a>
          ))}
        </div>
      </section>

      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 pb-10 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
        <a href="/privacy" className="transition-colors hover:text-signal">Confidentialité</a>
        <span className="text-line">·</span>
        <a href="/terms" className="transition-colors hover:text-signal">Conditions</a>
        <span className="text-line">·</span>
        <a href="mailto:contact@striveapp.fr" className="transition-colors hover:text-signal">Support</a>
      </footer>
    </main>
  );
}
