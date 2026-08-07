// ═══════════════════════════════════════════════════════════════════════════
// RevenueCat webhook — applique les events d'achat/renouvellement
// ═══════════════════════════════════════════════════════════════════════════
// Architecture lookup-table : on délègue toute la logique métier à la RPC
// public.apply_revenuecat_event qui lit la table subscription_products.
// → Modifier un pack ou le tier d'un SKU ne nécessite pas de redéployer cette
//   fonction, juste un UPDATE en DB.
//
// Setup :
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//   supabase secrets set REVENUECAT_WEBHOOK_AUTH=<token-aléatoire-fort>
//   Puis dans RevenueCat Dashboard → Integrations → Webhooks :
//     URL = https://<project>.supabase.co/functions/v1/revenuecat-webhook
//     Authorization header = Bearer <même token>
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_AUTH = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? '';
// Sandbox : par défaut on IGNORE les events SANDBOX (achats TestFlight/sandbox
// gratuits → sinon premium réel offert). Mettre REVENUECAT_ALLOW_SANDBOX=true
// sur un projet Supabase de test pour les accepter.
const ALLOW_SANDBOX = Deno.env.get('REVENUECAT_ALLOW_SANDBOX') === 'true';
// Clé secrète REST RevenueCat (v1). Optionnelle : elle sert uniquement aux
// events qui ne portent pas assez d'information pour décider seuls — aujourd'hui
// TRANSFER, qui n'a ni product_id ni expiration. Sans elle, le nouveau porteur
// est servi au prochain RENEWAL au lieu de l'être immédiatement.
const RC_SECRET_KEY = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface RevenueCatEvent {
  id?: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id: string;
  expiration_at_ms?: number;
  purchased_at_ms?: number;
  environment?: 'SANDBOX' | 'PRODUCTION';
  store?: string;
  cancel_reason?: string;
  // TRANSFER uniquement : l'event ne porte pas d'app_user_id, mais les listes des
  // comptes concernés.
  transferred_from?: string[];
  transferred_to?: string[];
}

interface RevenueCatPayload {
  event: RevenueCatEvent;
  api_version?: string;
}

// Mapping event → status pour les events non-couverts par la RPC
function statusForEvent(eventType: string, _cancelReason?: string): string | null {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
      return 'active';
    case 'CANCELLATION':
      return 'cancelled';
    case 'EXPIRATION':
      return 'expired';
    // Remboursement : la transaction est annulée, l'accès est coupé tout de
    // suite (la RPC ramène aussi subscription_expires_at à now()). À ne pas
    // confondre avec CANCELLATION, où la période déjà payée reste due.
    case 'REFUND':
      return 'refunded';
    case 'BILLING_ISSUE':
      return 'in_grace_period';
    case 'SUBSCRIPTION_PAUSED':
      return 'paused';
    default:
      return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TRANSFER : un même reçu Apple passe d'un App User ID à un autre (restauration
 * depuis un second compte, ou achat hors de l'app rattaché à l'ouverture).
 *
 * L'event ne porte ni product_id ni expiration, donc en deux temps :
 *  1. Révoquer les `transferred_from` — sinon deux comptes gardent l'accès pour
 *     un seul paiement, l'ancien jusqu'à sa date d'expiration.
 *  2. Accorder aux `transferred_to` en interrogeant l'API RevenueCat pour
 *     connaître le produit et l'expiration réels. Sans clé API configurée, on
 *     saute cette étape : le compte sera servi au prochain RENEWAL, ou par la
 *     réconciliation client au prochain lancement de l'app.
 */
async function handleTransfer(event: RevenueCatEvent) {
  const from = (event.transferred_from ?? []).filter(id => UUID_RE.test(id));
  const to = (event.transferred_to ?? []).filter(id => UUID_RE.test(id));
  console.info(`TRANSFER from=${JSON.stringify(event.transferred_from)} to=${JSON.stringify(event.transferred_to)}`);

  let revoked = 0;
  if (from.length > 0) {
    const { data, error } = await supabase.rpc('revoke_transferred_subscription', {
      p_user_ids: from,
      p_event_id: event.id ?? null,
    });
    if (error) console.error('revoke_transferred_subscription failed', error);
    else revoked = data ?? 0;
  }

  let granted = 0;
  for (const userId of to) {
    if (await grantFromRevenueCat(userId, event.id ?? null)) granted++;
  }
  return { transfer: { revoked, granted, skipped: to.length - granted } };
}

/**
 * Lit l'état réel de l'abonné chez RevenueCat (source de vérité) et l'applique.
 * Utilisé quand l'event lui-même ne porte pas assez d'information — cas TRANSFER.
 */
async function grantFromRevenueCat(userId: string, eventId: string | null): Promise<boolean> {
  if (!RC_SECRET_KEY) {
    console.warn(`TRANSFER to ${userId}: REVENUECAT_SECRET_API_KEY absente, octroi différé au prochain RENEWAL`);
    return false;
  }
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${RC_SECRET_KEY}` },
    });
    if (!res.ok) {
      console.error(`RC subscribers ${userId} → HTTP ${res.status}`);
      return false;
    }
    const body = await res.json();
    const entitlements = body?.subscriber?.entitlements ?? {};
    // On prend l'entitlement actif dont l'expiration est la plus lointaine.
    let best: { productId: string; expires: string } | null = null;
    for (const ent of Object.values<any>(entitlements)) {
      const expires = ent?.expires_date;
      const productId = ent?.product_identifier;
      if (!expires || !productId) continue;
      if (new Date(expires).getTime() <= Date.now()) continue;
      if (!best || new Date(expires) > new Date(best.expires)) {
        best = { productId, expires };
      }
    }
    if (!best) {
      console.info(`TRANSFER to ${userId}: aucun entitlement actif chez RC`);
      return false;
    }
    const { error } = await supabase.rpc('apply_revenuecat_event', {
      p_user_id: userId,
      p_event_type: 'INITIAL_PURCHASE',
      p_product_id: best.productId,
      p_expires_at: new Date(best.expires).toISOString(),
      p_status: 'active',
      // event_id dérivé : un TRANSFER peut viser plusieurs comptes, et la table
      // d'idempotence a l'event_id en clé primaire.
      p_event_id: eventId ? `transfer-grant-${eventId}-${userId}` : null,
    });
    if (error) {
      console.error('apply_revenuecat_event (transfer grant) failed', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`grantFromRevenueCat(${userId}) threw`, e);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Auth : RevenueCat envoie l'header Authorization configuré dans le dashboard
  const authHeader = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${WEBHOOK_AUTH}`;
  if (!WEBHOOK_AUTH || authHeader !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: RevenueCatPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = payload.event;
  if (!event || !event.type) {
    return new Response('Missing event fields', { status: 400 });
  }

  // Events ignorés — testé AVANT la validation des champs : TRANSFER ne porte ni
  // app_user_id ni product_id (il expose transferred_from / transferred_to), donc
  // le garde ci-dessous le rejetait en 400 sans jamais atteindre cette liste. RC
  // retentait alors en backoff jusqu'à abandon (6 échecs observés le 26/07).
  if (event.type === 'TRANSFER') {
    const result = await handleTransfer(event);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ignored = new Set(['TEST', 'INVOICE_ISSUANCE', 'SUBSCRIBER_ALIAS']);
  if (ignored.has(event.type)) {
    return new Response(JSON.stringify({ ok: true, ignored: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Events SANDBOX : jamais appliqués en prod (un achat sandbox est gratuit —
  // l'appliquer offrirait un vrai premium). 200 pour que RC ne retry pas.
  if (event.environment === 'SANDBOX' && !ALLOW_SANDBOX) {
    return new Response(JSON.stringify({ ok: true, ignored: 'sandbox' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Champs requis par la RPC — après la liste d'ignorés, qui contient les events
  // légitimement dépourvus d'app_user_id / product_id.
  if (!event.app_user_id || !event.product_id) {
    return new Response('Missing event fields', { status: 400 });
  }

  // app_user_id doit être l'UUID Supabase. Si l'app n'a pas appelé
  // Purchases.logIn(<auth.uid>), RevenueCat renvoie un anonymous_id → on rejette.
  const userId = event.app_user_id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    console.warn(`Ignoring event with non-UUID app_user_id: ${userId}`);
    return new Response(JSON.stringify({ ok: true, ignored: 'anonymous_user' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const expiresAt = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;

  const { error } = await supabase.rpc('apply_revenuecat_event', {
    p_user_id: userId,
    p_event_type: event.type,
    p_product_id: event.product_id,
    p_expires_at: expiresAt,
    p_status: statusForEvent(event.type, event.cancel_reason),
    // Déduplication : RC rejoue les webhooks sans 200 → la RPC ignore les
    // event.id déjà traités (table processed_webhook_events).
    p_event_id: event.id ?? null,
  });

  if (error) {
    console.error('apply_revenuecat_event failed', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
