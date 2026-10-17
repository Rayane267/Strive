'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { ago, fmt } from './types';
import { C, Card, Empty, Pill, Stat } from './ui';

/* ──────────────────────────────────────────────────────────────────────────
   Signalements de la carte (police, accident, danger, bouchon, travaux) et
   masquage préfectoral de la police — article L130-11 du Code de la route :
   à réception d'un arrêté, on doit cesser de rediffuser les signalements de
   contrôle dans la zone, 2 h au plus pour un dépistage d'alcool ou de
   stupéfiants, 12 h pour les autres opérations.
   ────────────────────────────────────────────────────────────────────────── */

type Kind = 'police' | 'accident' | 'danger' | 'traffic' | 'roadworks';

const KIND: Record<Kind, { label: string; color: string }> = {
  police: { label: 'Police', color: '#3D7BFF' },
  accident: { label: 'Accident', color: '#FF4D4D' },
  danger: { label: 'Danger', color: '#FF9F0A' },
  traffic: { label: 'Bouchon', color: '#B05CFF' },
  roadworks: { label: 'Travaux', color: '#FFD60A' },
};

interface Blackout {
  id: string;
  lat: number;
  lon: number;
  radius_m: number;
  starts_at: string;
  ends_at: string;
  note: string | null;
  active: boolean;
}

interface Report {
  id: string;
  kind: Kind;
  lat: number;
  lon: number;
  created_at: string;
  expires_at: string;
  confirmations: number;
  dismissals: number;
  removed: boolean;
  live: boolean;
}

interface Data {
  blackouts: Blackout[];
  by_kind: { kind: Kind; active: number; today: number }[];
  recent: Report[];
}

const mapsLink = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`;

/** « 48.8566, 2.3522 » tel que Google Maps le copie (clic droit sur la carte). */
function parseCoords(s: string): { lat: number; lon: number } | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const DURATIONS = [
  { minutes: 120, label: '2 h', hint: 'dépistage alcool / stupéfiants' },
  { minutes: 720, label: '12 h', hint: 'autres opérations' },
];

export default function ReportsView() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  // Chaque action incrémente ce compteur : la page se relit, comme useRpc.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('admin_road_reports').then(({ data: d, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else {
        setErr('');
        setData(d as Data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (err) return <p role="alert" className="p-8 text-center text-sm text-[#FF5A4D]">{err}</p>;
  if (!data) return <p className="p-8 text-center text-sm text-white/40">Chargement…</p>;

  const counts = (k: Kind) => data.by_kind.find((x) => x.kind === k) ?? { active: 0, today: 0 };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <Stat
            key={k}
            label={KIND[k].label}
            value={String(counts(k).active)}
            sub={`actifs · ${counts(k).today} aujourd'hui`}
          />
        ))}
      </div>

      <BlackoutForm onDone={load} />

      <Card
        title="Zones masquées"
        subtitle="Les signalements « police » qui tombent dans une zone active ne sont plus servis aux chauffeurs."
      >
        {data.blackouts.length === 0 ? (
          <Empty>Aucune zone ces 7 derniers jours.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.blackouts.map((b) => (
              <BlackoutRow key={b.id} b={b} onDone={load} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Derniers signalements" subtitle="Les 50 plus récents, retirés compris.">
        {data.recent.length === 0 ? (
          <Empty>Aucun signalement pour l&apos;instant.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.recent.map((r) => (
              <ReportRow key={r.id} r={r} onDone={load} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BlackoutForm({ onDone }: { onDone: () => void }) {
  const [coords, setCoords] = useState('');
  const [radius, setRadius] = useState('2000');
  const [minutes, setMinutes] = useState(120);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = parseCoords(coords);
    const r = Number(radius);
    if (!c) return setMsg({ ok: false, text: 'Coordonnées illisibles — format attendu : 48.8566, 2.3522' });
    if (!Number.isInteger(r) || r < 100 || r > 20000) {
      return setMsg({ ok: false, text: 'Rayon entre 100 et 20 000 m.' });
    }
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('admin_create_police_blackout', {
      p_lat: c.lat,
      p_lon: c.lon,
      p_radius_m: r,
      p_minutes: minutes,
      p_note: note,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: 'Zone masquée. La police n’y est plus servie, dès le prochain rafraîchissement des cartes.' });
    setCoords('');
    setNote('');
    onDone();
  };

  const input =
    'mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-[#00E676]/50';
  const label = 'block text-xs font-semibold uppercase tracking-wide text-white/60';

  return (
    <Card
      title="Masquer la police dans une zone"
      subtitle="À la réception d’un arrêté préfectoral (art. L130-11 du Code de la route)."
    >
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[2fr_1fr_1.2fr]">
        <div>
          <label htmlFor="bo-coords" className={label}>Centre (lat, lon)</label>
          <input
            id="bo-coords"
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            placeholder="48.8566, 2.3522"
            required
            className={input}
          />
          <p className="mt-1.5 text-xs" style={{ color: C.LOW }}>
            Google Maps : clic droit sur le lieu, puis clic sur les coordonnées pour les copier.
          </p>
        </div>
        <div>
          <label htmlFor="bo-radius" className={label}>Rayon (m)</label>
          <input
            id="bo-radius"
            type="number"
            min={100}
            max={20000}
            step={100}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            required
            className={input}
          />
        </div>
        <div>
          <span className={label}>Durée</span>
          <div className="mt-2 flex gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.minutes}
                type="button"
                onClick={() => setMinutes(d.minutes)}
                aria-pressed={minutes === d.minutes}
                title={d.hint}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold outline-none transition-colors ${
                  minutes === d.minutes
                    ? 'border-[#00E676]/50 bg-[#00E676]/10 text-[#E9F5EE]'
                    : 'border-white/10 text-[#8B958E] hover:text-[#E9F5EE]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: C.LOW }}>
            {DURATIONS.find((d) => d.minutes === minutes)?.hint}
          </p>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="bo-note" className={label}>Référence de l’arrêté (facultatif)</label>
          <input
            id="bo-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Arrêté n° …"
            className={input}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 lg:col-span-3">
          <button
            disabled={busy}
            className="rounded-lg bg-[#00E676] px-5 py-2.5 text-sm font-bold text-[#05140c] disabled:opacity-60"
          >
            {busy ? '…' : 'Masquer la police'}
          </button>
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className="text-sm" style={{ color: msg.ok ? C.SIGNAL : C.BAD }}>
              {msg.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

function BlackoutRow({ b, onDone }: { b: Blackout; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const end = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_end_police_blackout', { p_id: b.id });
    setBusy(false);
    if (error) alert(error.message);
    else onDone();
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Pill label={b.active ? 'Active' : 'Terminée'} color={b.active ? C.WARN : C.LOW} dim={!b.active} />
      <a
        href={mapsLink(b.lat, b.lon)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs underline decoration-white/20 underline-offset-2"
        style={{ color: C.MID }}
      >
        {b.lat.toFixed(4)}, {b.lon.toFixed(4)}
      </a>
      <span className="text-sm" style={{ color: C.MID }}>
        {b.radius_m >= 1000 ? `${(b.radius_m / 1000).toLocaleString('fr-FR')} km` : `${b.radius_m} m`}
      </span>
      <span className="text-sm" style={{ color: C.LOW }}>
        {fmt(b.starts_at)} → {fmt(b.ends_at)}
      </span>
      {b.note && (
        <span className="min-w-0 flex-1 truncate text-sm" style={{ color: C.LOW }}>
          {b.note}
        </span>
      )}
      {b.active && (
        <button
          onClick={end}
          disabled={busy}
          className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-[#E9F5EE] hover:bg-white/5 disabled:opacity-60"
        >
          Lever maintenant
        </button>
      )}
    </li>
  );
}

function ReportRow({ r, onDone }: { r: Report; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_remove_road_report', { p_id: r.id });
    setBusy(false);
    if (error) alert(error.message);
    else onDone();
  };
  const state = r.removed ? { label: 'Retiré', color: C.LOW } : r.live ? { label: 'Actif', color: C.SIGNAL } : { label: 'Expiré', color: C.LOW };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: KIND[r.kind]?.color ?? C.LOW }} aria-hidden />
      <span className="w-20 text-sm font-semibold" style={{ color: C.FG }}>
        {KIND[r.kind]?.label ?? r.kind}
      </span>
      <Pill label={state.label} color={state.color} dim={!r.live} />
      <span className="text-sm" style={{ color: C.LOW }}>
        {ago(r.created_at)}
      </span>
      <span className="text-sm tabular-nums" style={{ color: C.MID }} title="Toujours là / Plus là">
        ✓ {r.confirmations} · ✕ {r.dismissals}
      </span>
      <a
        href={mapsLink(r.lat, r.lon)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs underline decoration-white/20 underline-offset-2"
        style={{ color: C.MID }}
      >
        {r.lat.toFixed(4)}, {r.lon.toFixed(4)}
      </a>
      {r.live && (
        <button
          onClick={remove}
          disabled={busy}
          className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-[#E9F5EE] hover:bg-white/5 disabled:opacity-60"
        >
          Retirer
        </button>
      )}
    </li>
  );
}
