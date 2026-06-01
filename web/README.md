# Strive — Site web

Landing marketing premium pour l'app Strive (assistant chauffeurs VTC).

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19 + TypeScript
- Tailwind CSS v4
- Déployable sur Vercel

## Développement

```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm run build    # build de production
npm start        # serveur de production
```

## Structure

```
app/
├── layout.tsx          # métadonnées, polices, SEO/OpenGraph
├── page.tsx            # landing (hero, features, étapes, stats, CTA)
├── globals.css         # thème de marque + utilitaires (glow, glass, reveal)
├── components/         # Header, Footer, Pricing, Faq, PhoneMockup, Reveal, Logo
└── (legal)/            # /privacy et /terms
```

## Direction artistique — « tableau de bord de nuit »

Esthétique éditoriale × instrument automobile/HUD.

- **Palette** : canvas quasi-noir `#080A09`, surfaces `#0F1311`/`#161C18`, vert signal `#00E676` (GO), ambre `#FFC24B` (accent valeur), rouge `#FF5A4D` (refus).
- **Typographie** : Bricolage Grotesque (display), Hanken Grotesk (corps), JetBrains Mono (data/labels).
- **Détails** : grain SVG, lignes de grille blueprint, jauge €/h animée (`InstrumentCluster`), marquee, reveals au scroll, chiffres surdimensionnés. Tout en `prefers-reduced-motion`.

## À personnaliser

- Liens des badges App Store / Google Play (`StoreBadge` dans `page.tsx`) — placeholders `#`.
- Email de contact (footer + pages légales) : `bouboullover6@gmail.com`.
- `metadataBase` dans `layout.tsx` (actuellement `https://strive.app`).
- Visuel OpenGraph (`/og-image`) si besoin d'un aperçu de partage.
