import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Hanken_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

// Polices auto-hébergées par Next (plus de <link> bloquant vers Google Fonts :
// aucun aller-retour DNS/TLS externe, pas de FOUT, et rien à déclarer côté RGPD).
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bricolage',
});
const body = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
});
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://striveapp.fr'),
  alternates: { canonical: '/' },
  applicationName: 'Strive',
  title: 'Strive — Sache. Décide. Gagne.',
  description:
    'L\'assistant des chauffeurs VTC. Scanne chaque offre Uber, Bolt et Heetch en 2 secondes et n\'accepte plus jamais une course non rentable.',
  keywords: ['VTC', 'Uber', 'Bolt', 'Heetch', 'chauffeur', 'scanner course', 'taux horaire', 'Strive'],
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Strive — Sache. Décide. Gagne.',
    description:
      'Scanne chaque offre VTC en 2 secondes et vois ton €/h réel avant d\'accepter.',
    url: '/',
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Strive',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Strive — Sache. Décide. Gagne.',
    description: 'Scanne chaque offre VTC en 2 secondes et vois ton €/h réel.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: '#080A09',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${display.variable} ${body.variable} ${serif.variable} ${mono.variable}`}
    >
      <body className="grain">
        {children}
        {/* Mesure d'audience sans cookie ni identifiant persistant : aucune
            bannière de consentement requise. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
