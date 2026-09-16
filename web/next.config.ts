import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * CSP volontairement lisible plutôt que minimale :
 * - `unsafe-inline` en style est imposé par Tailwind + les `style={{…}}` de la
 *   landing (animations décalées) ;
 * - `unsafe-eval` n'est requis que par le HMR de `next dev` ;
 * - Vercel Analytics / Speed Insights servent leur script en same-origin
 *   (`/_vercel/…`) et envoient leurs beacons vers `*.vercel-insights.com` ;
 * - `*.supabase.co` couvre l'auth et les requêtes de la console `/admin`.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  // La redirection http→https est faite par la plateforme ; HSTS interdit au
  // navigateur de retenter en clair ensuite (2 ans, sous-domaines inclus).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Le repo contient deux lockfiles (app RN à la racine + site ici) : on fixe
  // explicitement la racine pour que Turbopack ne remonte pas d'un cran.
  turbopack: { root: __dirname },
  poweredByHeader: false,
  images: {
    // Sert AVIF/WebP aux navigateurs qui les acceptent.
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
