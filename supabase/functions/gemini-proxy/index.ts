// ═══════════════════════════════════════════════════════════════════════════
// gemini-proxy — proxy authentifié vers Gemini Vision
// ═══════════════════════════════════════════════════════════════════════════
// Hardening (audit Strive) :
//   1. verify_jwt côté Supabase (déclaré config.toml ou via supabase functions deploy)
//      → on revérifie quand même le JWT côté code par défense en profondeur.
//   2. Rate-limit 60 req/h par auth.uid() via la table audit_log (action=gemini_call).
//   3. Plafond body 2 MB (image base64 ≈ 1.4 MB max).
//   4. CORS restreint aux schemes app + capacitor + supabase studio.
//   5. Validation structurelle minimale du payload contents[].parts[].
//
// Setup :
//   supabase secrets set GEMINI_API_KEY=...
//   supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//   supabase functions deploy gemini-proxy            # JWT vérifié par défaut
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const GEMINI_API_KEY     = Deno.env.get('GEMINI_API_KEY') ?? '';
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY  = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const MAX_BODY_BYTES = 2 * 1024 * 1024;        // 2 MB hard cap
const RATE_LIMIT_PER_HOUR = 60;                // 60 calls / heure / user
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// Circuit breaker coût : plafond GLOBAL d'appels Gemini par 24h glissantes,
// tous users confondus. Protège la facture contre l'abus multi-comptes
// (le rate limit par user ne suffit pas : 100 comptes free = 6000 appels/h).
// Ajustable sans redéploiement via secret GEMINI_DAILY_BUDGET_CALLS.
const GLOBAL_DAILY_LIMIT = parseInt(Deno.env.get('GEMINI_DAILY_BUDGET_CALLS') ?? '2000', 10);
const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;

// Origines acceptées : app native (no Origin header), Supabase Studio, capacitor.
const ALLOWED_ORIGINS = new Set<string>([
  'https://supabase.com',
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:8081',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  // Apps RN n'envoient pas d'Origin → on accepte (auth via Bearer JWT).
  // Web : whitelist stricte.
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? '*') : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/** Extrait & vérifie le JWT Supabase. Retourne l'auth.uid() ou null. */
async function verifyAuth(req: Request): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token === SUPABASE_ANON_KEY) return null;   // anon key seule = refus
  // Client scoppé au token user → getUser revalide la signature côté Auth.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * Rate limit user (60/h) + budget global (24h glissantes), via audit_log.
 * FAIL-CLOSED : si la DB est injoignable on refuse — Gemini n'est qu'un
 * fallback de l'OCR local, mieux vaut le perdre temporairement que de
 * laisser le compteur de coûts sans garde-fou.
 */
async function isRateLimited(userId: string): Promise<'user' | 'global' | null> {
  if (!supabaseAdmin) return 'user';
  const userSince = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const globalSince = new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString();

  const [userRes, globalRes] = await Promise.all([
    supabaseAdmin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'gemini_call')
      .gte('created_at', userSince),
    supabaseAdmin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'gemini_call')
      .gte('created_at', globalSince),
  ]);

  if (userRes.error || globalRes.error) return 'user';   // fail-closed
  if ((userRes.count ?? 0) >= RATE_LIMIT_PER_HOUR) return 'user';
  if ((globalRes.count ?? 0) >= GLOBAL_DAILY_LIMIT) return 'global';
  return null;
}

async function logCall(userId: string, status: number, bytes: number): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('audit_log').insert({
    user_id: userId,
    action: 'gemini_call',
    details: { status, bytes },
  });
}

/** Validation minimale du payload Gemini. */
function isValidGeminiPayload(body: unknown): body is { contents: Array<{ parts: unknown[] }> } {
  if (!body || typeof body !== 'object') return false;
  const contents = (body as { contents?: unknown }).contents;
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > 4) return false;
  for (const c of contents) {
    if (!c || typeof c !== 'object') return false;
    const parts = (c as { parts?: unknown }).parts;
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > 8) return false;
  }
  return true;
}

serve(async (req: Request) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' }, origin);
  }
  if (!GEMINI_API_KEY) {
    return jsonResponse(500, { error: 'gemini_not_configured' }, origin);
  }

  // 1. Auth
  const userId = await verifyAuth(req);
  if (!userId) {
    return jsonResponse(401, { error: 'unauthorized' }, origin);
  }

  // 2. Rate-limit user + budget global (fail-closed)
  const limited = await isRateLimited(userId);
  if (limited) {
    if (limited === 'global') console.error('GEMINI GLOBAL BUDGET EXHAUSTED');
    return jsonResponse(429, { error: 'rate_limit_exceeded', scope: limited }, origin);
  }

  // 3. Plafond body
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'payload_too_large' }, origin);
  }

  // 4. Lecture + validation structurelle
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: 'payload_too_large' }, origin);
    }
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(400, { error: 'invalid_json' }, origin);
  }
  if (!isValidGeminiPayload(body)) {
    return jsonResponse(400, { error: 'invalid_payload' }, origin);
  }

  // 5. Forward Gemini
  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Le client abandonne à 12 s (AbortController côté JS, session dédiée
      // côté natif) : tenir la function au-delà ne fait que consommer du temps
      // d'exécution facturé pour une réponse que plus personne n'attend.
      signal: AbortSignal.timeout(15_000),
    });
    const data = await geminiRes.json();
    // Audit (best-effort, non bloquant)
    logCall(userId, geminiRes.status, contentLength).catch(() => {});
    return jsonResponse(geminiRes.status, data, origin);
  } catch (err) {
    // `detail` n'est pas renvoyé au client : l'erreur brute expose l'infra
    // interne (URL amont, pile Deno) à un appelant non fiable. Elle reste
    // dans les logs de la function, où elle est utile au diagnostic.
    console.error('gemini fetch failed', err);
    return jsonResponse(502, { error: 'gemini_unreachable' }, origin);
  }
});
