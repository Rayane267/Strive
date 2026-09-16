import type { Metadata } from 'next';
import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  Instrument_Serif,
  JetBrains_Mono,
} from 'next/font/google';
import './globals.css';
import { jsonLdGraph, organizationSchema, websiteSchema, SITE_URL } from './lib/schema';

// Auto-hébergées et préchargées par Next : les fichiers partent du même
// domaine que la page, dans le même build. Le <link> Google qui vivait ici
// imposait deux connexions tierces (fonts.googleapis puis fonts.gstatic) et
// une feuille bloquante avant le premier pixel — sur un réseau mobile, c'est
// le titre qui attend. `display: swap` garde le texte lisible entre-temps.
const display = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--f-display' });
const body = Hanken_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--f-body' });
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--f-serif',
});
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--f-mono' });
const fontVars = [display, body, serif, mono].map((f) => f.variable).join(' ');

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
    <html lang="fr" className={fontVars}>
      <head>
        {/* Sans JS, IntersectionObserver ne tourne jamais et `.reveal` reste à
            `opacity: 0` : la page entière serait blanche. Le repli rend le
            contenu tel quel, animation en moins. */}
        <noscript>
          <style>{`.reveal{opacity:1;transform:none}`}</style>
        </noscript>
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
