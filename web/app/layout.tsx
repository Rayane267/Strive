import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://striveapp.fr'),
  alternates: { canonical: '/' },
  title: 'Strive — Sache. Décide. Gagne.',
  description:
    'L\'assistant des chauffeurs VTC. Scanne chaque offre Uber, Bolt et Heetch en 2 secondes et n\'accepte plus jamais une course non rentable.',
  keywords: ['VTC', 'Uber', 'Bolt', 'Heetch', 'chauffeur', 'scanner course', 'taux horaire', 'Strive'],
  openGraph: {
    title: 'Strive — Sache. Décide. Gagne.',
    description:
      'Scanne chaque offre VTC en 2 secondes et vois ton €/h réel avant d\'accepter.',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="grain">{children}</body>
    </html>
  );
}
