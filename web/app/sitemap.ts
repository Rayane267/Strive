import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://striveapp.fr';
  const now = new Date();
  return [
    { url: `${base}/`,        lastModified: now, changeFrequency: 'weekly',  priority: 1 },
    { url: `${base}/waitlist`, lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly',  priority: 0.4 },
    { url: `${base}/terms`,   lastModified: now, changeFrequency: 'yearly',  priority: 0.4 },
  ];
}
