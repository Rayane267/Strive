import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// notify-untagged — push "Tague tes courses" aux chauffeurs ayant ≥ 5 courses
// PENDING non taguées. Déclenchée par pg_cron (voir migration 20260702). Envoi
// via FCM HTTP v1 (OAuth2 minté depuis un compte de service Google).
//
// Secrets Edge Function requis :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injectés d'office)
//   FCM_SERVICE_ACCOUNT_JSON = JSON du compte de service Firebase
// ─────────────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

const MESSAGES: Record<string, { title: string; body: (n: number) => string }> = {
  fr: {
    title: "Tague tes courses 🎯",
    body: (n) =>
      `${n} courses scannées attendent d'être acceptées ou refusées. Tague-les pour des stats bien plus précises.`,
  },
  en: {
    title: "Tag your rides 🎯",
    body: (n) =>
      `${n} scanned rides are waiting to be accepted or declined. Tag them for much more accurate stats.`,
  },
};

// base64url sans padding
function b64url(data: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof data === "string") bytes = new TextEncoder().encode(data);
  else bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

// Compte de service → access_token OAuth2 (scope firebase.messaging)
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

// Rôle porté par le JWT du header Authorization. La passerelle Supabase a déjà
// vérifié la signature avant d'atteindre la fonction → on peut lire le payload.
function jwtRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Garde : seul le service_role (le cron) peut déclencher les envois.
    if (jwtRole(req.headers.get("Authorization") ?? "") !== "service_role") {
      return new Response("Forbidden", { status: 403 });
    }

    const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!) as ServiceAccount;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // Sélectionne ET marque les candidats en une passe atomique.
    const { data: candidates, error } = await supabase.rpc("claim_untagged_nudges", {
      min_pending: 5,
      cooldown: "6 hours",
    });
    if (error) throw error;

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    let sent = 0;
    const staleTokens: string[] = [];

    for (const c of candidates) {
      const lang = c.preferred_lang === "en" ? "en" : "fr";
      const m = MESSAGES[lang];
      const n = Number(c.pending_count) || 0;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: c.fcm_token,
            notification: { title: m.title, body: m.body(n) },
            data: { type: "untagged_rides", count: String(n) },
          },
        }),
      });

      if (res.ok) {
        sent++;
      } else {
        // Token périmé (app désinstallée / permission retirée) → on le purge.
        if (res.status === 404 || res.status === 400) staleTokens.push(c.fcm_token);
        __DEBUG(res.status, await res.text());
      }
    }

    if (staleTokens.length > 0) {
      await supabase.from("profiles").update({ fcm_token: null }).in("fcm_token", staleTokens);
    }

    return new Response(JSON.stringify({ candidates: candidates.length, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// Log léger (visible dans les logs de la function) sans casser la boucle.
function __DEBUG(status: number, body: string) {
  console.warn(`[notify-untagged] FCM ${status}: ${body.slice(0, 200)}`);
}
