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
├── waitlist/           # /waitlist (coming soon + compte à rebours + inscription)
├── admin/              # console support : onglets Tickets + Analytics (noindex)
└── (legal)/            # /privacy, /terms, /mentions-legales
lib/
├── stores.ts           # URLs App Store / Google Play
└── supabaseClient.ts   # client navigateur (clé anon, sécurité par RLS)
```

## Liste d'attente (`/waitlist`)

Page « coming soon » autonome, calquée sur la référence envoyée par le produit :
fond noir + grain, halo lumineux **rotatif** autour du badge, de la carte et du
champ e-mail (conic-gradient en rotation masqué par le calque de contenu), titre
en dégradé, compte à rebours, carte à liseré haut, CTA blanc lumineux, écran de
succès (check animé + étincelles) et bascule du badge en « Inscrit ✅ ».
Typo Inter. Styles isolés dans `app/waitlist/waitlist.css` — le reste du site
garde sa DA verte.

- **Date d'ouverture** : `NEXT_PUBLIC_LAUNCH_DATE` (ISO 8601 avec fuseau, ex.
  `2026-10-01T00:00:00+02:00`). Valeur par défaut dans `app/waitlist/page.tsx`.
- **Anti-bot** : champ honeypot `company` (un bot qui le remplit voit un faux
  succès, rien n'est enregistré).
- **Backend** : migration `supabase/migrations/20260906_waitlist.sql` — table
  `public.waitlist` (RLS : lecture admin uniquement, aucun accès direct anon) et
  deux RPC `SECURITY DEFINER` :
  - `join_waitlist(p_email, p_source, p_locale, p_referrer)` → `{ position,
    already_registered, total }`, valide le format, refuse les e-mails jetables,
    dé-duplique sur l'e-mail normalisé (alias Gmail inclus).
  - `waitlist_count()` → compteur public.
- **Env requis** : `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Export des inscrits** : `select * from public.waitlist order by created_at;`
  depuis un compte `profiles.is_admin = true` (ou le service role).
- Les liens X / Instagram (`SOCIALS` dans `app/waitlist/page.tsx`) sont des
  placeholders à remplacer par les vrais comptes.

## Direction artistique — « tableau de bord de nuit »

Esthétique éditoriale × instrument automobile/HUD.

- **Palette** : canvas quasi-noir `#080A09`, surfaces `#0F1311`/`#161C18`, vert signal `#00E676` (GO), ambre `#FFC24B` (accent valeur), rouge `#FF5A4D` (refus). Tous les tons de texte passent le contraste WCAG AA sur le canvas.
- **Typographie** : Bricolage Grotesque (display), Hanken Grotesk (corps), JetBrains Mono (data/labels), Instrument Serif (accents). Auto-hébergées via `next/font/google`.
- **Détails** : grain SVG, lignes de grille blueprint, jauge €/h animée (`InstrumentCluster`), marquee, reveals au scroll, chiffres surdimensionnés. Tout en `prefers-reduced-motion`.

## Sécurité & conformité

- En-têtes définis dans `next.config.ts` : HSTS (2 ans, preload), CSP, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- Mesure d'audience **sans cookie** (Vercel Web Analytics + Speed Insights) → pas de
  bannière de consentement requise. Ajouter un outil à cookies obligerait à en mettre une.
- Pages légales obligatoires : `/mentions-legales` (LCEN), `/privacy` (RGPD), `/terms`.
- `/admin` est en `noindex` et exclue du `robots.txt` ; sa sécurité réelle repose sur les
  **policies RLS Supabase**, pas sur le contrôle `is_admin` côté client.
- L'onglet Analytics passe par le RPC `admin_analytics` (migration
  `20260916_admin_analytics.sql`), `SECURITY DEFINER` et gardé par `is_admin()`. Il ne
  renvoie que des compteurs et des moyennes : aucune ligne `profiles` ou `scan_events`
  n'atteint le navigateur. Nécessaire, car ces tables sont en RLS « chacun ne voit que
  ses lignes » — un agrégat parc n'y est pas lisible depuis le client.
