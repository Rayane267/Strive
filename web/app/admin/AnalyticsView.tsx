'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { Analytics } from './types';
import { Card, Stat } from './ui';
import LivePanel from './LivePanel';
import FeedView from './FeedView';

/* ──────────────────────────────────────────────────────────────────────────
   Palette data-viz — validée sur la surface #0F1311 (mode sombre) :
   bande de clarté, plancher de chroma, séparation daltonisme et contraste.
   · Catégoriel  : slots 1-2 (bleu / orange), ΔE daltonien 26,8 — hors zone
     de confusion. Un graphe mono-série utilise le seul slot 1.
   · Statut      : vert/ambre/rouge du produit, réservés aux verdicts (ils
     signifient bon/moyen/mauvais) et toujours accompagnés d'un libellé.
   · Ordinal     : rampe bleue mono-teinte pour les paliers d'abonnement.
   Les libellés et valeurs ne portent jamais la couleur d'une série.
   ────────────────────────────────────────────────────────────────────────── */
const C = {
  surface: '#0F1311',
  s1: '#3987e5',        // catégoriel 1 — analyse locale
  s2: '#d95926',        // catégoriel 2 — repli Gemini (coût)
  good: '#00E676',
  warn: '#FFC24B',
  bad: '#FF5A4D',
  tier: ['#86b6ef', '#3987e5', '#1c5cab'], // ordinal free → plus → premium
  grid: 'rgba(255,255,255,0.07)',
};

const RANGES = [
  { days: 7, label: '7 j' },
  { days: 30, label: '30 j' },
  { days: 90, label: '90 j' },
];

const nf = new Intl.NumberFormat('fr-FR');
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);
const pctLabel = (num: number, den: number) => {
  const p = pct(num, den);
  return p === null ? '—' : `${p} %`;
};

export default function AnalyticsView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setErr('');
    const { data: res, error } = await supabase.rpc('admin_analytics', { p_days: d });
    if (error) setErr(error.message);
    else setData(res as Analytics);
    setLoading(false);
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  if (err) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p role="alert" className="max-w-md text-center text-sm text-[#FF5A4D]">
          Impossible de charger les statistiques : {err}
        </p>
      </div>
    );
  }

  if (!data) {
    return <div className="flex flex-1 items-center justify-center text-white/50">Chargement des statistiques…</div>;
  }

  const s = data.scans;
  const subs = data.subscriptions;
  const paying = subs.plus + subs.premium;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">

        {/* Filtres — une seule rangée au-dessus des graphes */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-white/50">Période</span>
            <div className="flex gap-1 rounded-lg border border-white/10 p-1">
              {RANGES.map(r => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  aria-pressed={days === r.days}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    days === r.days ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/40">
            {loading && <span>mise à jour…</span>}
            <span>Arrêté le {new Date(data.generated_at).toLocaleString('fr-FR')}</span>
          </div>
        </div>

        <LivePanel />

        {/* KPI — la forme juste pour un chiffre seul, pas un graphe à une barre */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Comptes"
            value={nf.format(data.users.total)}
            sub={`+${nf.format(data.users.new_window)} sur la période`}
          />
          <Stat
            label="Abonnés payants"
            value={nf.format(paying)}
            sub={`${pctLabel(paying, data.users.total)} des comptes · ${nf.format(subs.active)} actifs`}
          />
          <Stat
            label="Scans"
            value={nf.format(s.total)}
            sub={`${nf.format(data.active_users.window)} chauffeurs actifs`}
          />
          <Stat
            label="Adresses détectées"
            value={pctLabel(s.both_addresses, s.total)}
            sub={`repli Gemini ${pctLabel(s.gemini_fallback, s.total)}`}
            hint="Part des scans où les deux adresses sont lues. Métrique cœur de la qualité OCR."
          />
        </div>

        <ScansDaily rows={data.scans_daily} />

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <PlatformBars rows={data.scans_by_platform} />
          <div className="space-y-6">
            <Verdicts scans={s} />
            <Tiers subs={subs} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Taux d'acceptation"
            value={pctLabel(data.rides.accepted, data.rides.accepted + data.rides.declined)}
            sub={`${nf.format(data.rides.total)} courses enregistrées`}
          />
          <Stat
            label="€/h moyen scanné"
            value={data.rides.avg_hourly_rate != null ? `${data.rides.avg_hourly_rate.toFixed(2).replace('.', ',')} €` : '—'}
            sub={data.rides.avg_fare != null ? `course moyenne ${data.rides.avg_fare.toFixed(2).replace('.', ',')} €` : 'aucune course'}
          />
          <Stat
            label="Heures en ligne"
            value={`${nf.format(Math.round(data.sessions.total_hours))} h`}
            sub={`${nf.format(data.sessions.total)} sessions · ${String(data.sessions.avg_hours).replace('.', ',')} h en moyenne`}
          />
          <Stat
            label="Tickets ouverts"
            value={nf.format(data.support.open)}
            sub={
              data.support_first_reply_minutes != null
                ? `1re réponse médiane : ${formatMinutes(data.support_first_reply_minutes)}`
                : 'aucune réponse sur la période'
            }
          />
        </div>

        <FeedView days={days} />
      </div>
    </div>
  );
}

function formatMinutes(m: number) {
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1).replace('.', ',')} h` : `${Math.round(h / 24)} j`;
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/60">
      <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/* ── Colonnes empilées : scans par jour ────────────────────────────────── */
/* Chemin à sommet arrondi (4px) et base carrée, ancré sur la ligne zéro. */
function topRoundedPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function ScansDaily({ rows }: { rows: Analytics['scans_daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const W = 960, H = 220, PAD_L = 40, PAD_R = 8, PAD_T = 10, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...rows.map(r => r.total));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];
  const band = rows.length > 0 ? plotW / rows.length : plotW;
  // Barre fine : ~58 % de la bande, plafonnée — le reste de la bande est de
  // l'air. Une colonne qui remplit son créneau lit comme un bloc, pas comme
  // une donnée.
  const bw = Math.min(24, Math.max(2, band * 0.58));
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH;

  const totals = rows.reduce((a, r) => a + r.total, 0);
  const fallbacks = rows.reduce((a, r) => a + r.fallback, 0);

  return (
    <Card
      title="Scans par jour"
      subtitle={`${nf.format(totals)} scans · ${nf.format(fallbacks)} passés par Gemini`}
      aside={
        <div className="flex items-center gap-4">
          <LegendKey color={C.s1} label="Analyse locale" />
          <LegendKey color={C.s2} label="Repli Gemini" />
          <button
            onClick={() => setTable(v => !v)}
            className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:text-white"
          >
            {table ? 'Voir le graphe' : 'Voir les données'}
          </button>
        </div>
      }
    >
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0F1311] text-white/50">
              <tr>
                <th scope="col" className="py-1.5 font-medium">Jour</th>
                <th scope="col" className="py-1.5 text-right font-medium">Local</th>
                <th scope="col" className="py-1.5 text-right font-medium">Gemini</th>
                <th scope="col" className="py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-white/75">
              {rows.map(r => (
                <tr key={r.day} className="border-t border-white/5">
                  <td className="py-1.5">{new Date(r.day).toLocaleDateString('fr-FR')}</td>
                  <td className="py-1.5 text-right">{nf.format(r.total - r.fallback)}</td>
                  <td className="py-1.5 text-right">{nf.format(r.fallback)}</td>
                  <td className="py-1.5 text-right">{nf.format(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
               aria-label={`Scans par jour sur ${rows.length} jours, dont ${fallbacks} repli Gemini`}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
                <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">
                  {nf.format(t)}
                </text>
              </g>
            ))}

            {rows.map((r, i) => {
              const x = PAD_L + i * band + (band - bw) / 2;
              const local = r.total - r.fallback;
              const hasFb = r.fallback > 0;
              // Écart de 2px en couleur de surface entre segments empilés.
              const gap = hasFb && local > 0 ? 2 : 0;
              const hTotal = (r.total / top) * plotH;
              const hFb = hasFb ? (r.fallback / top) * plotH : 0;
              const hLocal = Math.max(0, hTotal - hFb - gap);
              const yFb = PAD_T + plotH - hTotal;
              return (
                <g key={r.day}
                   onMouseEnter={() => setHover(i)}
                   onMouseLeave={() => setHover(h => (h === i ? null : h))}>
                  {/* Cible de survol plus large que la colonne */}
                  <rect x={PAD_L + i * band} y={PAD_T} width={band} height={plotH}
                        fill={hover === i ? 'rgba(255,255,255,0.04)' : 'transparent'} />
                  {hasFb && <path d={topRoundedPath(x, yFb, bw, hFb)} fill={C.s2} />}
                  {local > 0 && hLocal > 0 && (
                    <path
                      d={hasFb
                        ? `M${x},${PAD_T + plotH} L${x},${yFb + hFb + gap} L${x + bw},${yFb + hFb + gap} L${x + bw},${PAD_T + plotH} Z`
                        : topRoundedPath(x, PAD_T + plotH - hLocal, bw, hLocal)}
                      fill={C.s1}
                    />
                  )}
                </g>
              );
            })}

            <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke={C.grid} strokeWidth="1" />
            {[...new Set([0, Math.floor(rows.length / 2), rows.length - 1])]
              .filter(i => i >= 0 && rows[i])
              .map(i => (
              <text key={i} x={PAD_L + i * band + band / 2} y={H - 8} textAnchor="middle"
                    fontSize="10" fill="rgba(255,255,255,0.4)">
                {new Date(rows[i].day).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
              </text>
            ))}
          </svg>

          {hover !== null && rows[hover] && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg border border-white/15 bg-[#161C18] px-3 py-2 text-xs shadow-xl"
              style={{
                left: `${Math.min(88, Math.max(12, ((PAD_L + (hover + 0.5) * band) / W) * 100))}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <p className="font-semibold text-white">
                {new Date(rows[hover].day).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-white/70">
                <span className="h-2 w-2 rounded-sm" style={{ background: C.s1 }} />
                Local <span className="tabular-nums text-white">{nf.format(rows[hover].total - rows[hover].fallback)}</span>
              </p>
              <p className="flex items-center gap-1.5 text-white/70">
                <span className="h-2 w-2 rounded-sm" style={{ background: C.s2 }} />
                Gemini <span className="tabular-nums text-white">{nf.format(rows[hover].fallback)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Barres horizontales mono-série : une seule couleur pour toutes ────── */
function PlatformBars({ rows }: { rows: Analytics['scans_by_platform'] }) {
  const max = Math.max(1, ...rows.map(r => r.total));
  return (
    <Card title="Scans par plateforme" subtitle="Volume et qualité de lecture sur la période">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">Aucun scan sur la période.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map(r => (
            <li key={r.platform}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-white">{r.platform}</span>
                <span className="tabular-nums text-white/70">{nf.format(r.total)}</span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-[4px] bg-white/[0.06]">
                <div className="h-full rounded-[4px]" style={{ width: `${(r.total / max) * 100}%`, background: C.s1 }} />
              </div>
              <p className="mt-1.5 text-xs text-white/45">
                {pctLabel(r.both_addresses, r.total)} d&apos;adresses détectées · {pctLabel(r.fallback, r.total)} de repli Gemini
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Part-à-tout : verdicts (couleurs de statut, toujours étiquetées) ──── */
function Verdicts({ scans }: { scans: Analytics['scans'] }) {
  const segs = [
    { label: 'Rentable', value: scans.verdict_good, color: C.good },
    { label: 'Limite', value: scans.verdict_mid, color: C.warn },
    { label: 'À refuser', value: scans.verdict_bad, color: C.bad },
  ];
  return <PartToWhole title="Verdicts rendus" subtitle="Répartition des scans sur la période" segs={segs} />;
}

/* ── Part-à-tout : paliers d'abonnement (rampe ordinale mono-teinte) ───── */
function Tiers({ subs }: { subs: Analytics['subscriptions'] }) {
  const segs = [
    { label: 'Gratuit', value: subs.free, color: C.tier[0] },
    { label: 'Plus', value: subs.plus, color: C.tier[1] },
    { label: 'Premium', value: subs.premium, color: C.tier[2] },
  ];
  return <PartToWhole title="Paliers d'abonnement" subtitle="Tous comptes confondus" segs={segs} />;
}

function PartToWhole({ title, subtitle, segs }: {
  title: string; subtitle: string; segs: { label: string; value: number; color: string }[];
}) {
  const total = segs.reduce((a, x) => a + x.value, 0);
  return (
    <Card title={title} subtitle={subtitle}>
      {total === 0 ? (
        <p className="py-4 text-center text-sm text-white/40">Aucune donnée sur la période.</p>
      ) : (
        <>
          {/* Écart de 2px en couleur de surface entre segments, pas de bordure. */}
          <div className="flex h-3 w-full overflow-hidden rounded-[4px]" style={{ gap: 2 }}>
            {segs.filter(x => x.value > 0).map(x => (
              <div key={x.label} style={{ flexGrow: x.value, background: x.color }} />
            ))}
          </div>
          <ul className="mt-4 space-y-1.5">
            {segs.map(x => (
              <li key={x.label} className="flex items-center justify-between text-xs">
                <LegendKey color={x.color} label={x.label} />
                <span className="tabular-nums text-white/70">
                  {nf.format(x.value)} <span className="text-white/40">({pctLabel(x.value, total)})</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Graduations rondes (0 / 50 / 100…) plutôt que le maximum brut. */
function niceTicks(max: number, count: number): number[] {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step; v += step) out.push(Math.round(v));
  return out;
}
