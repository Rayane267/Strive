import type { Metadata } from 'next';
import './globals.css';
import { jsonLdGraph, organizationSchema, websiteSchema, SITE_URL } from './lib/schema';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  title: 'Strive — Sache. Décide. Gagne.',
  description:
    'L\'assistant des chauffeurs VTC. Scanne chaque offre Uber, Bolt et Heetch en 2 secondes et n\'accepte plus jamais une course non rentable.',
  keywords: ['VTC', 'Uber', 'Bolt', 'Heetch', 'chauffeur', 'scanner course', 'taux horaire', 'Strive'],
  applicationName: 'Strive',
  category: 'business',
  // Sans ces directives, Google tronque les extraits à ~160 caractères et
  // limite l'aperçu image. Les résumés génératifs se construisent sur
  // l'extrait autorisé : le brider revient à se citer soi-même en moins bien.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
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
        {/* Entités de site (Organization + WebSite) : présentes sur toutes les
            pages pour que les moteurs rattachent l'éditeur au domaine. Le
            balisage produit (MobileApplication, FAQPage) est sur l'accueil. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLdGraph(organizationSchema, websiteSchema)),
          }}
        />
      </head>
      <body className="grain">{children}</body>
    </html>
  );
}
