import { createClient } from '@supabase/supabase-js';

// Client navigateur (clé anon). Toute la sécurité repose sur les policies RLS
// Supabase (is_admin) : un non-admin connecté ne verra que ses propres tickets.
// Fallback placeholder : évite un crash au build quand les env ne sont pas
// encore là (dev local). Sur Vercel, les vraies valeurs NEXT_PUBLIC_* sont
// inlinées au build. Aucun appel réseau n'a lieu au prerender (tout est en
// useEffect côté client).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
