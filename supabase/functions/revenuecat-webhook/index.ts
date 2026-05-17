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

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id: string;
  expiration_at_ms?: number;
  purchased_at_ms?: number;
  environment?: 'SANDBOX' | 'PRODUCTION';
  store?: string;
  cancel_reason?: string;
}

interface RevenueCatPayload {
  event: RevenueCatEvent;
  api_version?: string;
}

// Mapping event → status pour les events non-couverts par la RPC
function statusForEvent(eventType: string, cancelReason?: string): string | null {
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
    case 'BILLING_ISSUE':
      return 'in_grace_period';
    case 'SUBSCRIPTION_PAUSED':
      return 'paused';
    default:
      return null;
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
  if (!event || !event.type || !event.app_user_id || !event.product_id) {
    return new Response('Missing event fields', { status: 400 });
  }

  // Events ignorés (transferts entre comptes, tests sandbox côté RC, etc.)
  const ignored = new Set(['TRANSFER', 'TEST', 'INVOICE_ISSUANCE']);
  if (ignored.has(event.type)) {
    return new Response(JSON.stringify({ ok: true, ignored: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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
