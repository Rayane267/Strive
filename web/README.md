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
├── layout.tsx          # métadonnées, polices (next/font), analytics, SEO/OpenGraph
├── page.tsx            # landing (hero, features, étapes, stats, CTA)
├── not-found.tsx       # 404 personnalisée
├── error.tsx           # écran d'erreur client
├── globals.css         # thème de marque + utilitaires (glow, glass, reveal)
├── components/         # Header, Footer, Pricing, Faq, PhoneMockup, Reveal, Logo
├── admin/              # console support (auth Supabase, noindex)
└── (legal)/            # /privacy, /terms, /mentions-legales
lib/
├── stores.ts           # URLs App Store / Google Play
└── supabaseClient.ts   # client navigateur (clé anon, sécurité par RLS)
```

## Direction artistique — « tableau de bord de nuit »

Esthétique éditoriale × instrument automobile/HUD.

- **Palette** : canvas quasi-noir `#080A09`, surfaces `#0F1311`/`#161C18`, vert signal `#00E676` (GO), ambre `#FFC24B` (accent valeur), rouge `#FF5A4D` (refus). Tous les tons de texte passent le contraste WCAG AA sur le canvas.
- **Typographie** : Bricolage Grotesque (display), Hanken Grotesk (corps), JetBrains Mono (data/labels), Instrument Serif (accents). Auto-hébergées via `next/font/google`.
- **Détails** : grain SVG, lignes de grille blueprint, jauge €/h animée (`InstrumentCluster`), marquee, reveals au scroll, chiffres surdimensionnés. Tout en `prefers-reduced-motion`.

## Sécurité & conformité

- En-têtes définis dans `next.config.ts` : HSTS (2 ans, preload), CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- Mesure d'audience **sans cookie** (Vercel Web Analytics + Speed Insights) → pas de bannière de consentement requise. Ajouter un outil à cookies obligerait à en mettre une.
- Pages légales obligatoires : `/mentions-legales` (LCEN), `/privacy` (RGPD), `/terms`.
- `/admin` est en `noindex` et exclue du `robots.txt` ; sa sécurité réelle repose sur les **policies RLS Supabase**, pas sur le contrôle `is_admin` côté client.

## À personnaliser avant lancement

- **`lib/stores.ts`** — renseigner les URLs App Store / Google Play. Tant qu'elles valent `null`, les badges s'affichent « Bientôt sur … » et ne sont pas cliquables.
- **`app/(legal)/mentions-legales/page.tsx`** — le numéro de téléphone de l'éditeur est marqué `À COMPLÉTER` (obligatoire LCEN).
- Vérifier que la boîte `contact@striveapp.fr` est bien opérationnelle (utilisée dans le footer et les 3 pages légales).
- Confirmer le domaine de production : `metadataBase` dans `layout.tsx`, `robots.ts` et `sitemap.ts` pointent tous sur `https://striveapp.fr`.
