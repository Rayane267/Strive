import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: 'https://striveapp.fr/sitemap.xml',
    host: 'https://striveapp.fr',
  };
}
