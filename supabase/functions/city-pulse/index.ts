// Vue « Afflux » : rafraîchit `city_signals` depuis les sources publiques.
// Appelée toutes les 5 min par pg_cron (migration 20261010_city_signals).
//
// Une source qui échoue ne touche pas à ses lignes : mieux vaut un signal
// vieux de 10 min qu'une liste vidée par une panne de l'API.
//
// Déploiement :
//   supabase secrets set PRIM_API_KEY=<jeton PRIM> SNCF_API_KEY=<clé API SNCF> \
//     GRANDLYON_LOGIN=<e-mail> GRANDLYON_PASSWORD=<mot de passe plateforme de données>
//   supabase functions deploy city-pulse      # JWT vérifié par défaut

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { IDFM_URL, idfmSignals, parisNow, type SignalRow } from "./idfm.ts";
import { STATIONS, arrivalsUrl, sncfWave } from "./sncf.ts";
import { AMP_URL, ampSignals } from "./amp.ts";
import { TCL_URL, tclSignals } from "./tcl.ts";
import { footballEvents, footballUrl } from "./football.ts";
import { curatedEvents } from "./curated.ts";
import GtfsRealtimeBindings from "https://esm.sh/gtfs-realtime-bindings@1.1.1";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async req => {
  // Seul le cron (service_role) déclenche un rafraîchissement : chaque appel
  // consomme le quota PRIM (20 000 requêtes/jour).
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) {
    return json({ error: "forbidden" }, 403);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
  const report: Record<string, unknown> = {};
  const now = parisNow();
  const minute = +now.slice(11, 13);

  const refresh = async (source: string, load: () => Promise<SignalRow[]>) => {
    try {
      const rows = await load();
      const { data, error } = await supabase.rpc("replace_city_signals", { p_source: source, p_rows: rows });
      if (error) throw error;
      report[source] = data;
    } catch (e) {
      report[source] = { error: (e as Error).message };
    }
  };

  await refresh("idfm", async () => {
    const res = await fetch(IDFM_URL, { headers: { apikey: Deno.env.get("PRIM_API_KEY")! } });
    if (!res.ok) throw new Error(`PRIM ${res.status}`);
    return idfmSignals(await res.json(), now);
  });

  await refresh("amp", async () => {
    const res = await fetch(AMP_URL);
    if (!res.ok) throw new Error(`AMP ${res.status}`);
    const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
    const feed = FeedMessage.toObject(
      FeedMessage.decode(new Uint8Array(await res.arrayBuffer())),
      { longs: Number, enums: String },
    );
    return ampSignals(feed, Math.floor(Date.now() / 1000));
  });

  await refresh("tcl", async () => {
    // btoa() refuse les caractères hors Latin-1 : on passe par l'UTF-8.
    const creds = new TextEncoder().encode(`${Deno.env.get("GRANDLYON_LOGIN")}:${Deno.env.get("GRANDLYON_PASSWORD")}`);
    const auth = `Basic ${btoa(String.fromCharCode(...creds))}`;
    const res = await fetch(TCL_URL, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`TCL ${res.status}`);
    return tclSignals(await res.json(), Math.floor(Date.now() / 1000));
  });

  // Calendrier de Ligue 1 : il bouge à la journée, une fois par heure suffit.
  if (minute < 5) {
    await refresh("football", async () => {
      const res = await fetch(footballUrl());
      if (!res.ok) throw new Error(`openfootball ${res.status}`);
      return footballEvents(await res.json());
    });
    await refresh("curated", async () => curatedEvents());
  }

  // Gares : un passage sur trois (toutes les 15 min). 16 gares × 96 passages
  // ≈ 1 540 requêtes/jour, sous le quota gratuit de 5 000. Les horaires
  // bougent peu, et un retard se voit encore au passage suivant.
  if (minute % 15 < 5) {
    await refresh("sncf", async () => {
      const auth = `Basic ${btoa(`${Deno.env.get("SNCF_API_KEY")}:`)}`;
      const waves = await Promise.all(STATIONS.map(async st => {
        const res = await fetch(arrivalsUrl(st.id, now), { headers: { Authorization: auth } });
        if (!res.ok) throw new Error(`SNCF ${st.name} ${res.status}`);
        return sncfWave(st, await res.json());
      }));
      return waves.filter((w): w is SignalRow => w !== null);
    });
  }

  const failed = Object.values(report).some(v => typeof v === "object");
  return json(report, failed ? 502 : 200);
});
