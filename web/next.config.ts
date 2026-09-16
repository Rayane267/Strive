import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Le dépôt contient deux package-lock.json : celui de l'app React Native à la
  // racine et celui du site ici. Sans racine explicite, Turbopack remonte au
  // premier lockfile trouvé et prend D:/…/strive comme racine du projet — les
  // chemins de sortie et le tracing des fichiers partent alors de l'app mobile.
  // La racine, c'est ce dossier.
  turbopack: { root: __dirname },

  // Les en-têtes de sécurité ne coûtent rien à servir et ferment les usages où
  // le site est encadré par un tiers ou son référent fuit vers l'extérieur.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
