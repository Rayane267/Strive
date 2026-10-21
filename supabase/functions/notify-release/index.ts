import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// notify-release — push « Mise à jour disponible » à tous les appareils d'une
// plateforme. Déclenchée À LA MAIN, une fois la version servie par le store et
// `app_release` relevée (cf. migration 20261015_app_release) : la version et
// les nouveautés du message viennent de cette table.
//
// Body : { "platform": "ios" | "android", "dry_run"?: true }
//   dry_run → renvoie destinataires et messages, n'envoie rien.
//
// Les appareils qui ont déjà signalé cette version ou une plus récente
// (profiles.app_version, écrit à chaque démarrage de session) sont sautés. Ceux
// qui n'ont rien signalé n'ont encore ouvert aucune version qui le fait : ils
// reçoivent le push.
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

// Pas de numéro de version dans le titre : le chauffeur n'en a que faire, il
// doit seulement savoir qu'il y a une mise à jour à télécharger.
const MESSAGES: Record<string, { title: string; cta: string }> = {
  fr: { title: "Mise à jour disponible", cta: "Une nouvelle mise à jour est disponible, télécharge-la !" },
  en: { title: "Update available", cta: "A new update is available, download it!" },
  de: { title: "Update verfügbar", cta: "Ein neues Update ist verfügbar, lade es herunter!" },
  es: { title: "Actualización disponible", cta: "Hay una nueva actualización disponible, ¡descárgala!" },
  it: { title: "Aggiornamento disponibile", cta: "È disponibile un nuovo aggiornamento, scaricalo!" },
  nl: { title: "Update beschikbaar", cta: "Er is een nieuwe update beschikbaar, download hem!" },
  pt: { title: "Atualização disponível", cta: "Há uma nova atualização disponível, descarrega-a!" },
};

// Même repli que l'app (appReleaseService.pickNotes) : langue, sinon en, sinon fr.
function compose(lang: string, notes: Record<string, unknown>) {
  const m = MESSAGES[lang] ?? MESSAGES.en;
  const raw = notes[lang] ?? notes.en ?? notes.fr;
  const list = Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string") : [];
  const body = list.length > 0 ? `${list.join(" · ")}\n${m.cta}` : m.cta;
  return { title: m.title, body };
}

// Comparaison numérique segment par segment : « 1.0.10 » > « 1.0.9 ». Copie de
// appReleaseService.compareVersions.
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

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

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Garde : un push à tous les chauffeurs ne part que sur décision admin.
    if (jwtRole(req.headers.get("Authorization") ?? "") !== "service_role") {
      return new Response("Forbidden", { status: 403 });
    }

    const { platform, dry_run } = await req.json().catch(() => ({}));
    if (platform !== "ios" && platform !== "android") {
      return json({ error: "platform: 'ios' | 'android'" }, 400);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const { data: release, error: relErr } = await supabase
      .from("app_release")
      .select("latest_version, notes")
      .eq("platform", platform)
      .maybeSingle();
    if (relErr) throw relErr;
    if (!release?.latest_version) return json({ error: "app_release vide" }, 400);

    const { data: rows, error } = await supabase
      .from("profiles")
      .select("fcm_token, preferred_lang, app_version")
      .eq("device_platform", platform)
      .not("fcm_token", "is", null);
    if (error) throw error;

    const notes = (release.notes ?? {}) as Record<string, unknown>;
    const version = release.latest_version as string;

    const devices = (rows ?? []).filter(
      (d) => !d.app_version || compareVersions(d.app_version, version) < 0,
    );
    const upToDate = (rows?.length ?? 0) - devices.length;

    if (dry_run) {
      const langs: Record<string, number> = {};
      for (const d of devices) {
        const l = d.preferred_lang ?? "?";
        langs[l] = (langs[l] ?? 0) + 1;
      }
      const preview = Object.fromEntries(
        Object.keys(langs).map((l) => [l, compose(l, notes)]),
      );
      return json({ dry_run: true, version, devices: devices.length, up_to_date: upToDate, langs, preview });
    }

    if (devices.length === 0) return json({ version, up_to_date: upToDate, sent: 0 });

    const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!) as ServiceAccount;
    const accessToken = await getAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    let sent = 0;
    const staleTokens: string[] = [];

    for (const d of devices) {
      const m = compose(d.preferred_lang ?? "en", notes);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: d.fcm_token,
            notification: { title: m.title, body: m.body },
            data: { type: "app_update", version },
          },
        }),
      });

      if (res.ok) {
        sent++;
      } else {
        // Token périmé (app désinstallée / permission retirée) → on le purge.
        if (res.status === 404 || res.status === 400) staleTokens.push(d.fcm_token);
        console.warn(`[notify-release] FCM ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    }

    if (staleTokens.length > 0) {
      await supabase.from("profiles").update({ fcm_token: null }).in("fcm_token", staleTokens);
    }

    return json({ version, devices: devices.length, up_to_date: upToDate, sent });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
