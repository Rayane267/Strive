import type { Metadata, Viewport } from 'next';
import Waitlist from './Waitlist';
import './waitlist.css';

// Date d'ouverture : surchargeable sans redéploiement via l'env Vercel
// NEXT_PUBLIC_LAUNCH_DATE (ISO 8601 avec fuseau).
const LAUNCH_DATE = process.env.NEXT_PUBLIC_LAUNCH_DATE || '2026-10-01T00:00:00+02:00';

export const metadata: Metadata = {
  title: 'Strive — Coming soon',
  description:
    'Rejoins la liste d\'attente Strive. Scan des courses, €/h réel et trafic temps réel — bientôt disponible.',
  alternates: { canonical: '/waitlist' },
  openGraph: {
    title: 'Strive — Coming soon',
    description: 'Rejoins la liste d\'attente. Sois le premier prévenu du lancement.',
    url: '/waitlist',
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Strive',
  },
};

export const viewport: Viewport = { themeColor: '#080a09' };

export default function WaitlistPage() {
  return (
    <div className="wl">
      <div className="wl-bg" aria-hidden="true" />
      <div className="wl-noise" aria-hidden="true" />

      <div className="wl-screen">
        <Waitlist target={LAUNCH_DATE} />

        <footer className="wl-foot">
          <div className="wl-social">
            <a href="https://x.com/striveapp_fr" aria-label="X" target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.5 3h3.1l-6.8 7.8L22 21h-6.2l-4.8-6.3L5.7 21H2.6l7.3-8.3L2 3h6.4l4.4 5.8L17.5 3Zm-1.1 16.2h1.7L7.7 4.7H5.9l10.5 14.5Z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/striveapp.fr"
              aria-label="Instagram"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
              </svg>
            </a>
          </div>
          <p className="wl-legal">
            <a href="/privacy">Confidentialité</a>
            <span aria-hidden="true">·</span>
            <a href="/terms">Conditions</a>
            <span aria-hidden="true">·</span>
            <a href="mailto:contact@striveapp.fr">Support</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
