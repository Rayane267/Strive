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
├── waitlist/           # /waitlist (coming soon + compte à rebours + inscription)
└── (legal)/            # /privacy et /terms
```

## Liste d'attente (`/waitlist`)

Page « coming soon » autonome : badge, compte à rebours, carte d'inscription,
réseaux sociaux, liens légaux.

- **Date d'ouverture** : `NEXT_PUBLIC_LAUNCH_DATE` (ISO 8601 avec fuseau, ex.
  `2026-10-01T09:00:00+02:00`). Valeur par défaut dans `app/waitlist/page.tsx`.
- **Backend** : migration `supabase/migrations/20260906_waitlist.sql` — table
  `public.waitlist` (RLS : lecture admin uniquement, aucun accès direct anon) et
  deux RPC `SECURITY DEFINER` :
  - `join_waitlist(p_email, p_source, p_locale, p_referrer)` → `{ position,
    already_registered, total }`, valide le format, refuse les e-mails jetables,
    dé-duplique sur l'e-mail normalisé (alias Gmail inclus).
  - `waitlist_count()` → compteur public affiché sous le formulaire.
- **Env requis** : `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Export des inscrits** : `select * from public.waitlist order by created_at;`
  depuis un compte `profiles.is_admin = true` (ou le service role).
- Les liens X / Instagram (`SOCIALS` dans `app/waitlist/page.tsx`) sont des
  placeholders à remplacer par les vrais comptes.

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
