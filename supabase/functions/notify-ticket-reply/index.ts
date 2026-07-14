import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// notify-ticket-reply — push à l'utilisateur quand le support (staff) répond à
// son ticket. Déclenchée par un trigger DB (pg_net) sur support_messages.
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FCM_SERVICE_ACCOUNT_JSON.
// ─────────────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

const MESSAGES: Record<string, { title: string; body: (s: string) => string }> = {
  fr: { title: "Réponse du support 💬", body: (s) => `Le support Strive a répondu à « ${s} ».` },
  en: { title: "Support replied 💬", body: (s) => `Strive support replied to "${s}".` },
};

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof data === "string") bytes = new TextEncoder().encode(data);
  else bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: sa.token_uri, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

function jwtRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? null; } catch { return null; }
}

serve(async (req) => {
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (jwtRole(req.headers.get("Authorization") ?? "") !== "service_role") {
      return new Response("Forbidden", { status: 403 });
    }

    const { ticket_id } = await req.json().catch(() => ({}));
    if (!ticket_id) return new Response(JSON.stringify({ error: "ticket_id required" }), { status: 400 });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const { data: ticket } = await supabase
      .from("support_tickets").select("user_id, subject").eq("id", ticket_id).single();
    if (!ticket) return new Response(JSON.stringify({ sent: 0, reason: "no_ticket" }), { headers: { "Content-Type": "application/json" } });

    const { data: profile } = await supabase
      .from("profiles").select("fcm_token, preferred_lang").eq("id", ticket.user_id).single();
    if (!profile?.fcm_token) return new Response(JSON.stringify({ sent: 0, reason: "no_token" }), { headers: { "Content-Type": "application/json" } });

    const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!) as ServiceAccount;
    const accessToken = await getAccessToken(sa);
    const lang = profile.preferred_lang === "en" ? "en" : "fr";
    const m = MESSAGES[lang];

    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: profile.fcm_token,
          notification: { title: m.title, body: m.body(ticket.subject) },
          data: { type: "ticket_reply", ticket_id: String(ticket_id), subject: String(ticket.subject ?? "") },
        },
      }),
    });

    if (!res.ok && (res.status === 404 || res.status === 400)) {
      await supabase.from("profiles").update({ fcm_token: null }).eq("fcm_token", profile.fcm_token);
    }
    return new Response(JSON.stringify({ sent: res.ok ? 1 : 0 }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
