import { supabase } from './supabase';

/**
 * Signalements de la carte (police, accident, danger, bouchon, travaux).
 *
 * Tout passe par trois RPC (cf. 20261014_road_reports.sql) : les tables n'ont
 * aucune policy. Durées de vie, dédoublonnage à 150 m, plafond de dix par heure
 * et masquage préfectoral de la police sont décidés côté serveur — l'app ne
 * fait qu'afficher et transmettre.
 */
export type RoadReportKind = 'police' | 'accident' | 'danger' | 'traffic' | 'roadworks';

/**
 * Coupé pour la 1.0.6 : les signalements demandent la position du chauffeur,
 * ce qui impose de déclarer la localisation dans la fiche de confidentialité
 * App Store (et Sécurité des données Play) avant de les publier. Éteint, la
 * carte des zones reste et l'app ne demande AUCUNE position : ni bouton
 * « Signaler », ni point bleu, ni lecture des signalements.
 * Pour rallumer : déclarer la localisation, remettre la phrase d'usage dans
 * Info.plist et les permissions Android, puis passer à `true`.
 */
export const ROAD_REPORTS_ENABLED = false;

/** Ordre d'affichage dans le sélecteur. */
export const ROAD_REPORT_KINDS: RoadReportKind[] = ['police', 'accident', 'danger', 'traffic', 'roadworks'];

export type RoadReport = {
  id: string;
  kind: RoadReportKind;
  lat: number;
  lon: number;
  created_at: string;
  expires_at: string;
  confirmations: number;
  /** Posé par ce chauffeur : il peut le retirer, pas le confirmer. */
  mine: boolean;
  /** Ce chauffeur a déjà voté dessus. */
  voted: boolean;
};

export type ReportBounds = { minLat: number; minLon: number; maxLat: number; maxLon: number };

/** Distance en mètres, même approximation que le serveur
 *  (`road_report_distance_m`) : à quelques centaines de mètres, l'écart avec
 *  le grand cercle ne se mesure pas. */
export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return 6_371_000 * Math.sqrt(x * x + y * y);
}

export async function fetchRoadReports(b: ReportBounds): Promise<RoadReport[]> {
  const { data, error } = await supabase.rpc('road_reports_in_view', {
    p_min_lat: b.minLat,
    p_min_lon: b.minLon,
    p_max_lat: b.maxLat,
    p_max_lon: b.maxLon,
  });
  if (error) throw error;
  return ((data ?? []) as RoadReport[]).map(r => ({ ...r, lat: Number(r.lat), lon: Number(r.lon) }));
}

/** `merged` : un signalement identique existait à moins de 150 m, le nôtre l'a
 *  confirmé au lieu d'en poser un second. */
export async function createRoadReport(
  kind: RoadReportKind,
  lat: number,
  lon: number,
): Promise<{ id: string; merged: boolean }> {
  const { data, error } = await supabase.rpc('create_road_report', { p_kind: kind, p_lat: lat, p_lon: lon });
  if (error) {
    if (error.message?.includes('road_report_rate_limited')) throw new Error('RATE_LIMITED');
    throw error;
  }
  return data as { id: string; merged: boolean };
}

export type VoteResult = {
  ok: boolean;
  removed?: boolean;
  reason?: 'gone' | 'own_report' | 'already_voted';
};

export async function voteRoadReport(id: string, stillThere: boolean): Promise<VoteResult> {
  const { data, error } = await supabase.rpc('vote_road_report', { p_report_id: id, p_still_there: stillThere });
  if (error) throw error;
  return data as VoteResult;
}
