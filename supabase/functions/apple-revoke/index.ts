// ═══════════════════════════════════════════════════════════════════════════
// apple-revoke — révocation du jeton Sign in with Apple à la suppression
// ═══════════════════════════════════════════════════════════════════════════
// POURQUOI. App Store Review Guideline 5.1.1(v) : une app qui propose Sign in
// with Apple et qui permet de supprimer son compte DOIT révoquer les jetons
// Apple associés. Supprimer la ligne `auth.users` ne suffit pas — côté Apple,
// Strive reste listé dans « Se connecter avec Apple » des réglages du
// téléphone, comme si le compte existait toujours. C'est un motif de rejet
// classique, et il tombe à la première soumission.
//
// POURQUOI CÔTÉ SERVEUR. La révocation exige un `client_secret` signé en ES256
// avec la clé privée .p8 du compte développeur. Cette clé ne peut pas vivre
// dans le bundle de l'app : quiconque la sort peut se faire passer pour Strive
// auprès d'Apple. D'où cette fonction, seul endroit où elle est lisible.
//
// LE FLUX (deux appels chez Apple, dans cet ordre) :
//   1. /auth/token   — échange l'`authorizationCode` fraîchement obtenu sur
//                      l'appareil contre un refresh_token.
//   2. /auth/revoke  — révoque ce refresh_token, ce qui détache l'app du
//                      compte Apple de l'utilisateur.
// Le code d'autorisation est à usage unique et expire en ~5 minutes : il doit
// être demandé au moment de la suppression, pas réutilisé depuis la connexion.
//
// Setup :
//   supabase secrets set APPLE_TEAM_ID=XXXXXXXXXX
//   supabase secrets set APPLE_KEY_ID=YYYYYYYYYY
//   supabase secrets set APPLE_CLIENT_ID=com.striveapp.app   # bundle id
//   supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_YYYYYYYYYY.p8)"
//   supabase functions deploy apple-revoke
//
// Les trois premiers sont ceux déjà renseignés dans le provider Apple de
// Supabase Auth — même clé, même Team ID. Rien de nouveau à générer.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const APPLE_TEAM_ID     = Deno.env.get('APPLE_TEAM_ID') ?? '';
const APPLE_KEY_ID      = Deno.env.get('APPLE_KEY_ID') ?? '';
const APPLE_CLIENT_ID   = Deno.env.get('APPLE_CLIENT_ID') ?? '';
const APPLE_PRIVATE_KEY = Deno.env.get('APPLE_PRIVATE_KEY') ?? '';

const APPLE_TOKEN_URL  = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

const ALLOWED_ORIGINS = new Set<string>([
  'https://supabase.com',
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:8081',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  // Apps RN n'envoient pas d'Origin → on accepte (auth via Bearer JWT).
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

/** base64url sans padding — l'encodage de JWS. */
function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlText(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

/**
 * Importe la clé .p8 (PEM PKCS#8) en clé ECDSA P-256.
 * Le secret est passé par `supabase secrets set`, où les retours à la ligne
 * peuvent arriver échappés en `\n` littéraux : on rétablit les deux formes.
 */
async function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * `client_secret` attendu par Apple : un JWT ES256 signé avec la clé .p8.
 * Durée volontairement courte (5 min) — il n'est utilisé que dans la foulée,
 * et Apple autorise jusqu'à 6 mois, ce qui n'a aucun intérêt ici.
 *
 * WebCrypto renvoie la signature ECDSA au format brut r||s, qui est exactement
 * celui de JWS ES256 : aucune conversion DER à faire.
 */
async function buildClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' };
  const payload = {
    iss: APPLE_TEAM_ID,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: APPLE_CLIENT_ID,
  };
  const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;
  const key = await importApplePrivateKey(APPLE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

/** Extrait & vérifie le JWT Supabase. Retourne l'auth.uid() ou null. */
async function verifyAuth(req: Request): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token === SUPABASE_ANON_KEY) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

serve(async (req: Request) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' }, origin);
  }
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_CLIENT_ID || !APPLE_PRIVATE_KEY) {
    // Explicite plutôt que muet : une révocation qu'on croit faite et qui ne
    // l'est pas, c'est le rejet App Store sans l'avoir vu venir.
    console.error('apple-revoke: secrets manquants');
    return jsonResponse(500, { error: 'apple_not_configured' }, origin);
  }

  // 1. Auth — seul le titulaire du compte peut révoquer son propre jeton.
  const userId = await verifyAuth(req);
  if (!userId) {
    return jsonResponse(401, { error: 'unauthorized' }, origin);
  }

  // 2. Le code d'autorisation, fraîchement obtenu sur l'appareil.
  let authorizationCode = '';
  try {
    const body = await req.json();
    authorizationCode = typeof body?.authorizationCode === 'string' ? body.authorizationCode : '';
  } catch {
    return jsonResponse(400, { error: 'invalid_json' }, origin);
  }
  if (!authorizationCode || authorizationCode.length > 512) {
    return jsonResponse(400, { error: 'missing_authorization_code' }, origin);
  }

  try {
    const clientSecret = await buildClientSecret();

    // 3. Code → refresh_token.
    const tokenRes = await fetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      // `error` d'Apple est court et non sensible (invalid_grant, invalid_client…)
      // et c'est précisément ce qu'il faut voir dans les logs pour diagnostiquer.
      console.error('apple-revoke: token exchange failed', tokenRes.status, tokenJson?.error);
      return jsonResponse(502, { error: 'apple_token_exchange_failed', detail: tokenJson?.error ?? null }, origin);
    }

    // Le refresh_token est ce qui rattache durablement l'app au compte Apple.
    // À défaut, l'access_token fait l'affaire — Apple accepte les deux, avec
    // le bon `token_type_hint`.
    const refreshToken = tokenJson?.refresh_token as string | undefined;
    const accessToken  = tokenJson?.access_token as string | undefined;
    const token     = refreshToken ?? accessToken;
    const tokenHint = refreshToken ? 'refresh_token' : 'access_token';
    if (!token) {
      console.error('apple-revoke: aucun token renvoyé par Apple');
      return jsonResponse(502, { error: 'apple_no_token' }, origin);
    }

    // 4. Révocation.
    const revokeRes = await fetch(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APPLE_CLIENT_ID,
        client_secret: clientSecret,
        token,
        token_type_hint: tokenHint,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!revokeRes.ok) {
      const detail = await revokeRes.text().catch(() => '');
      console.error('apple-revoke: revoke failed', revokeRes.status, detail.slice(0, 200));
      return jsonResponse(502, { error: 'apple_revoke_failed' }, origin);
    }

    // Apple répond 200 avec un corps vide.
    return jsonResponse(200, { revoked: true }, origin);
  } catch (err) {
    // L'erreur brute exposerait l'infra interne à un appelant non fiable ; elle
    // reste dans les logs de la function, où elle sert au diagnostic.
    console.error('apple-revoke: unexpected', err);
    return jsonResponse(502, { error: 'apple_unreachable' }, origin);
  }
});
