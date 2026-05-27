import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOUV_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

const PARIS_DEPARTMENTS = ["75", "92", "93", "94"];

async function fetchAveragePrice(fuelId: string): Promise<number | null> {
  const where = PARIS_DEPARTMENTS.map(d => `cp LIKE '${d}%'`).join(" OR ");
  const params = new URLSearchParams({
    select: "prix_valeur",
    where: `(${where}) AND prix_nom='${fuelId}'`,
    limit: "200",
  });

  const res = await fetch(`${GOUV_API}?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  const prices: number[] = (data.results || [])
    .map((r: any) => r.prix_valeur)
    .filter((v: any) => typeof v === "number" && v > 0);

  if (prices.length === 0) return null;
  return prices.reduce((a: number, b: number) => a + b, 0) / prices.length / 1000;
}

serve(async (req) => {
  try {
    const [sp95, gazole, e10, e85] = await Promise.all([
      fetchAveragePrice("SP95"),
      fetchAveragePrice("Gazole"),
      fetchAveragePrice("E10"),
      fetchAveragePrice("E85"),
    ]);

    const prices = {
      essence: e10 ?? sp95,
      diesel: gazole,
      e85,
      updated_at: new Date().toISOString(),
      region: "paris",
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    await supabase.from("fuel_prices").upsert(
      {
        id: "paris",
        essence: prices.essence,
        diesel: prices.diesel,
        e85: prices.e85,
        updated_at: prices.updated_at,
      },
      { onConflict: "id" }
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
