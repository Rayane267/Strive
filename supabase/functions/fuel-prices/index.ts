import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOUV_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

serve(async () => {
  try {
    // Schéma 2026 : une colonne par carburant, déjà en €/L. On échantillonne
    // les stations d'Île-de-France (75/92/93/94) et on moyenne.
    const params = new URLSearchParams({
      select: "e10_prix,sp95_prix,gazole_prix,e85_prix",
      where: 'code_departement in ("75","92","93","94")',
      limit: "100", // max autorisé par l'API v2.1
    });

    const res = await fetch(`${GOUV_API}?${params}`);
    if (!res.ok) throw new Error(`API gouv ${res.status}`);
    const data = await res.json();
    const rows: any[] = data.results || [];

    const avg = (key: string): number | null => {
      const vals = rows
        .map(r => r[key])
        .filter((v: any) => typeof v === "number" && v > 0);
      if (vals.length === 0) return null;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
    };

    const prices = {
      essence: avg("e10_prix") ?? avg("sp95_prix"),
      diesel: avg("gazole_prix"),
      e85: avg("e85_prix"),
      updated_at: new Date().toISOString(),
      region: "paris",
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("fuel_prices").upsert(
      {
        id: "paris",
        essence: prices.essence,
        diesel: prices.diesel,
        e85: prices.e85,
        updated_at: prices.updated_at,
      },
      { onConflict: "id" },
    );

    return new Response(JSON.stringify(prices), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
