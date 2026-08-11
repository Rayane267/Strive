import type { MetadataRoute } from 'next';
import { SITE_URL } from './lib/schema';

// Les crawlers génératifs sont listés explicitement plutôt que laissés au
// joker : ils sont couverts par la règle `*`, mais une règle nommée est ce qui
// permet de vérifier d'un coup d'œil qu'on ne les a pas bloqués — et elle
// survit à un durcissement futur du joker.
const AI_CRAWLERS = [
  'GPTBot',           // OpenAI — entraînement + citations ChatGPT
  'OAI-SearchBot',    // OpenAI — index de recherche ChatGPT
  'ChatGPT-User',     // OpenAI — récupération à la demande d'un utilisateur
  'ClaudeBot',        // Anthropic
  'Claude-User',      // Anthropic — récupération à la demande
  'PerplexityBot',    // Perplexity
  'Google-Extended',  // Google — Gemini / AI Overviews
  'Applebot-Extended',// Apple Intelligence
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: '/admin' },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: '/', disallow: '/admin' })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
