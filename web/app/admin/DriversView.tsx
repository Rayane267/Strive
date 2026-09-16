'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { TIER, ago, eur, type DriversPage, type DriverRow, type Tier } from './types';
import { OnlineDot, Pill } from './ui';
import DriverDetail from './DriverDetail';

const PAGE = 50;
const nf = new Intl.NumberFormat('fr-FR');

type Sort = 'last_seen' | 'created_at' | 'tier' | 'email';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'last_seen',  label: 'Vus récemment' },
  { id: 'created_at', label: 'Derniers inscrits' },
  { id: 'tier',       label: 'Palier' },
  { id: 'email',      label: 'E-mail (A→Z)' },
];

const TIER_FILTERS: { id: Tier | null; label: string }[] = [
  { id: null,      label: 'Tous' },
  { id: 'free',    label: 'Gratuit' },
  { id: 'plus',    label: 'Plus' },
  { id: 'premium', label: 'Premium' },
];

export default function DriversView() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tier, setTier] = useState<Tier | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('last_seen');
  const [offset, setOffset] = useState(0);

  const [page, setPage] = useState<DriversPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Frappe au clavier : une requête par lettre saturerait la base pour rien.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Changer un filtre remet à la première page : rester en page 3 d'une liste
  // qui n'en compte plus qu'une affiche un tableau vide sans rien expliquer.
  useEffect(() => { setOffset(0); }, [debounced, tier, onlineOnly, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_drivers', {
      p_search: debounced || null,
      p_tier: tier,
      p_online: onlineOnly ? true : null,
      p_sort: sort,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error) { setErr(error.message); setPage(null); }
    else { setErr(''); setPage(data as DriversPage); }
    setLoading(false);
  }, [debounced, tier, onlineOnly, sort, offset]);

  useEffect(() => { load(); }, [load]);

  const rows = page?.rows ?? [];
  const total = page?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  const onlineCount = useMemo(() => rows.filter((r) => r.session_since).length, [rows]);

  if (err) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p role="alert" className="max-w-md text-center text-sm text-[#FF5A4D]">{err}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-4 p-5 sm:p-8">

          {/* ── Filtres ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E-mail, nom ou identifiant…"
              aria-label="Rechercher un chauffeur"
              className="min-w-[16rem] flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#00E676]/50"
            />

            <div className="flex gap-1 rounded-lg border border-white/10 p-1">
              {TIER_FILTERS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setTier(t.id)}
                  aria-pressed={tier === t.id}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    tier === t.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setOnlineOnly((v) => !v)}
              aria-pressed={onlineOnly}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                onlineOnly
                  ? 'border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]'
                  : 'border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              <OnlineDot />
              En ligne
            </button>

            <label className="flex items-center gap-2 text-xs text-white/50">
              Tri
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-[#00E676]/50"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#0F1311]">{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-white/40" aria-live="polite">
            {loading ? 'Chargement…' : `${nf.format(total)} chauffeur${total > 1 ? 's' : ''}`}
            {!loading && total > 0 && ` · ${from}–${to} affichés · ${onlineCount} en ligne sur cette page`}
          </p>

          {/* ── Tableau ──────────────────────────────────────────────── */}
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[64rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-left">
                  <Th>Chauffeur</Th>
                  <Th>Palier</Th>
                  <Th>Activité</Th>
                  <Th right>Scans 7 j</Th>
                  <Th right>Scans 30 j</Th>
                  <Th right>Courses 30 j</Th>
                  <Th right>Heures 30 j</Th>
                  <Th right hint="Somme des courses acceptées, consolidée en euros au taux figé de chaque course.">
                    Gains 30 j
                  </Th>
                  <Th right>Quota du jour</Th>
                  <Th right>Tickets</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-sm text-white/40">
                      Aucun chauffeur ne correspond.
                    </td>
                  </tr>
                )}
                {rows.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelected(d.id)}
                    className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${
                      selected === d.id ? 'bg-white/[0.05]' : ''
                    }`}
                  >
                    <td className="max-w-[18rem] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {d.session_since && <OnlineDot />}
                        <span className="min-w-0">
                          <span className="block truncate text-white">
                            {d.name ?? d.email ?? d.id.slice(0, 8)}
                          </span>
                          {d.name && d.email && (
                            <span className="block truncate text-xs text-white/40">{d.email}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill label={TIER[d.tier].label} color={TIER[d.tier].color} />
                      {d.status && d.status !== 'active' && (
                        <span className="ml-1.5 text-[10px] uppercase text-[#FFC24B]">{d.status}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-white/60">
                      {d.session_since ? 'en ligne' : ago(d.last_seen)}
                    </td>
                    <Td>{nf.format(d.scans_7d)}</Td>
                    <Td>{nf.format(d.scans_30d)}</Td>
                    <Td>
                      {nf.format(d.rides_30d)}
                      {d.rides_30d > 0 && (
                        <span className="text-white/35"> · {d.accepted_30d} prises</span>
                      )}
                    </Td>
                    <Td>{d.hours_30d != null ? `${String(d.hours_30d).replace('.', ',')} h` : '—'}</Td>
                    <Td>{eur(d.earnings_30d_eur)}</Td>
                    <Td>
                      {/* Le compteur n'a de sens qu'avec sa borne de journée :
                          périmé, le serveur le lit comme zéro. */}
                      {isToday(d.daily_scans_day) ? nf.format(d.scans_today) : '0'}
                      {d.credits > 0 && <span className="text-[#00E676]"> +{d.credits}</span>}
                    </Td>
                    <Td>
                      {d.tickets_open > 0
                        ? <span className="text-[#FFB300]">{d.tickets_open}</span>
                        : <span className="text-white/25">—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ───────────────────────────────────────────── */}
          {total > PAGE && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                disabled={offset === 0}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 disabled:opacity-30 hover:enabled:bg-white/10"
              >
                ← Précédents
              </button>
              <span className="text-xs text-white/40">{from}–{to} sur {nf.format(total)}</span>
              <button
                onClick={() => setOffset((o) => o + PAGE)}
                disabled={to >= total}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 disabled:opacity-30 hover:enabled:bg-white/10"
              >
                Suivants →
              </button>
            </div>
          )}
        </div>
      </div>

      {selected && <DriverDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Le compteur de quota porte la journée à laquelle il se rapporte : s'il
 *  date d'hier, il ne vaut plus rien (cf. enforce_scan_quota). */
function isToday(day: string | null) {
  if (!day) return false;
  const d = new Date(day);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function Th({ children, right = false, hint }: {
  children: React.ReactNode; right?: boolean; hint?: string;
}) {
  return (
    <th
      title={hint}
      className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/45 ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-right tabular-nums text-white/80">{children}</td>;
}
