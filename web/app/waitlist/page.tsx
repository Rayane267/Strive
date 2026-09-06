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
