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

/** Compte les appels gemini_call de l'user dans la dernière heure (audit_log). */
async function isRateLimited(userId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabaseAdmin
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('action', 'gemini_call')
    .gte('created_at', since);
  if (error) return false;                           // fail-open : pas de blocage si DB down
  return (count ?? 0) >= RATE_LIMIT_PER_HOUR;
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

  // 2. Rate-limit
  if (await isRateLimited(userId)) {
    return jsonResponse(429, { error: 'rate_limit_exceeded' }, origin);
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
    });
    const data = await geminiRes.json();
    // Audit (best-effort, non bloquant)
    logCall(userId, geminiRes.status, contentLength).catch(() => {});
    return jsonResponse(geminiRes.status, data, origin);
  } catch (err) {
    return jsonResponse(502, { error: 'gemini_unreachable', detail: String(err) }, origin);
  }
});
