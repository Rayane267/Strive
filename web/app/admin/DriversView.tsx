'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { TIER, ago, eur, type DriversPage, type Tier } from './types';
import { useAnalytics, useLive } from './data';
import { C, Metric, Surface } from './ui';
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

export default function DriversView({ initialDriver = null }: { initialDriver?: string | null }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tier, setTier] = useState<Tier | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('last_seen');
  const [offset, setOffset] = useState(0);

  const [page, setPage] = useState<DriversPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(initialDriver);

  const { data: stats } = useAnalytics(30);
  const { data: live } = useLive();

  useEffect(() => { if (initialDriver) setSelected(initialDriver); }, [initialDriver]);

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

  // La fiche prend tout l'écran : un chauffeur à la fois, rien qui réclame
  // l'attention derrière.
  if (selected) return <DriverDetail id={selected} onBack={() => setSelected(null)} />;

  const rows = page?.rows ?? [];
  const total = page?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);
  const online = live ? live.drivers.filter((d) => !d.stale).length : null;
  const paying = stats ? stats.subscriptions.plus + stats.subscriptions.premium : null;
  const filtered = !!debounced || tier !== null || onlineOnly;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#0A120E]">
      <div className="mx-auto max-w-7xl space-y-5 p-5 sm:p-8">

        {/* ── Le parc en quatre chiffres ───────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Inscrits"
            value={stats ? nf.format(stats.users.total) : '—'}
            unit="comptes"
            sub={stats
              ? `+${nf.format(stats.users.new_7d)} cette semaine · +${nf.format(stats.users.new_30d)} sur 30 jours`
              : ''}
            lead
          />
          <Metric
            label="En ligne"
            value={online != null ? String(online) : '—'}
            tone={online ? C.SIGNAL : undefined}
            sub={
              live && live.counts.stale > 0
                ? `${live.counts.stale} session${live.counts.stale > 1 ? 's' : ''} orpheline${live.counts.stale > 1 ? 's' : ''} en plus`
                : 'sessions de conduite ouvertes'
            }
          />
          <Metric
            label="Abonnés payants"
            value={paying != null ? nf.format(paying) : '—'}
            sub={
              stats
                ? `${nf.format(stats.subscriptions.plus)} Plus · ${nf.format(stats.subscriptions.premium)} Premium` +
                  (stats.subscriptions.grace > 0 ? ` · ${stats.subscriptions.grace} en grâce` : '')
                : ''
            }
          />
          <Metric
            label="Actifs sur 30 jours"
            value={stats ? nf.format(stats.active_users.window) : '—'}
            sub={
              stats && stats.users.total > 0
                ? `${Math.round((stats.active_users.window / stats.users.total) * 100)} % du parc · ${nf.format(stats.active_users.d7)} cette semaine`
                : ''
            }
          />
        </div>

        {/* ── Filtres ──────────────────────────────────────────────────── */}
        <Surface depth={1}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E-mail, nom ou identifiant…"
              aria-label="Rechercher un chauffeur"
              className="min-w-[16rem] flex-1 rounded-xl border px-3.5 py-2.5 text-sm outline-none"
              style={{ borderColor: C.LINE, background: 'rgba(233,245,238,0.04)', color: C.FG }}
            />

            <div className="flex gap-1 rounded-xl border p-1" style={{ borderColor: C.LINE }}>
              {TIER_FILTERS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setTier(t.id)}
                  aria-pressed={tier === t.id}
                  className="rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150"
                  style={tier === t.id
                    ? { background: 'rgba(233,245,238,0.09)', color: C.FG }
                    : { color: C.LOW }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setOnlineOnly((v) => !v)}
              aria-pressed={onlineOnly}
              className="flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition-colors duration-150"
              style={onlineOnly
                ? { borderColor: 'rgba(0,230,118,0.4)', background: 'rgba(0,230,118,0.10)', color: C.SIGNAL }
                : { borderColor: C.LINE, color: C.LOW }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: onlineOnly ? C.SIGNAL : C.LOW }} />
              En ligne
            </button>

            <label className="flex items-center gap-2 text-[13px]" style={{ color: C.LOW }}>
              Tri
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-xl border px-2.5 py-2 text-[13px] outline-none"
                style={{ borderColor: C.LINE, background: 'rgba(233,245,238,0.04)', color: C.FG }}
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#0F1A15]">{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-3 text-[13px]" style={{ color: C.LOW }} aria-live="polite">
            {loading
              ? 'Chargement…'
              : `${nf.format(total)} chauffeur${total > 1 ? 's' : ''}${filtered ? ' correspondent' : ''}${
                  total > PAGE ? ` · ${from}–${to} affichés` : ''
                }`}
          </p>
        </Surface>

        {err && <p role="alert" className="text-sm" style={{ color: C.BAD }}>{err}</p>}

        {/* ── La liste ─────────────────────────────────────────────────── */}
        <Surface depth={2}>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[60rem] border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Chauffeur</Th>
                  <Th>Palier</Th>
                  <Th>Activité</Th>
                  <Th right>Scans 7 j</Th>
                  <Th right>Scans 30 j</Th>
                  <Th right>Courses 30 j</Th>
                  <Th right>Heures</Th>
                  <Th right hint="Courses acceptées, consolidées en euros au taux figé de chaque course.">Gains</Th>
                  <Th right>Quota</Th>
                  <Th right>Tickets</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="px-2 py-10 text-center text-sm" style={{ color: C.LOW }}>
                      {filtered
                        ? 'Aucun chauffeur ne correspond à ces filtres.'
                        : 'Aucun chauffeur inscrit pour le moment.'}
                    </td>
                  </tr>
                )}
                {rows.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelected(d.id)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelected(d.id); }}
                    className="cursor-pointer outline-none transition-colors duration-150 hover:bg-white/[0.045] focus-visible:bg-white/[0.07]"
                    style={{ borderTop: `1px solid ${C.LINE}` }}
                  >
                    <td className="max-w-[20rem] px-2 py-3">
                      <div className="flex items-center gap-2.5">
                        {d.session_since && (
                          <span className="h-2 w-2 flex-none rounded-full" style={{ background: C.SIGNAL }} />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-[15px]" style={{ color: C.FG }}>
                            {d.name ?? d.email ?? d.id.slice(0, 8)}
                          </span>
                          {d.name && d.email && (
                            <span className="block truncate text-[13px]" style={{ color: C.LOW }}>{d.email}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                        style={{ background: TIER[d.tier].color + '1F', color: TIER[d.tier].color }}
                      >
                        {TIER[d.tier].label}
                      </span>
                      {d.status && d.status !== 'active' && (
                        <span className="ml-2 text-[11px] uppercase" style={{ color: C.WARN }}>{d.status}</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-[13px]" style={{ color: d.session_since ? C.SIGNAL : C.MID }}>
                      {d.session_since ? 'en ligne' : ago(d.last_seen)}
                    </td>
                    <Td>{nf.format(d.scans_7d)}</Td>
                    <Td>{nf.format(d.scans_30d)}</Td>
                    <Td>
                      {nf.format(d.rides_30d)}
                      {d.rides_30d > 0 && <span style={{ color: C.LOW }}> · {d.accepted_30d} prises</span>}
                    </Td>
                    <Td>{d.hours_30d != null ? `${String(d.hours_30d).replace('.', ',')} h` : '—'}</Td>
                    <Td>{eur(d.earnings_30d_eur)}</Td>
                    <Td>
                      {/* Le compteur n'a de sens qu'avec sa borne de journée :
                          périmé, le serveur le lit comme zéro. */}
                      {isToday(d.daily_scans_day) ? nf.format(d.scans_today) : '0'}
                      {d.credits > 0 && <span style={{ color: C.SIGNAL }}> +{d.credits}</span>}
                    </Td>
                    <Td>
                      {d.tickets_open > 0
                        ? <span style={{ color: C.WARN }}>{d.tickets_open}</span>
                        : <span style={{ color: C.LOW }}>—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className="mt-4 flex items-center justify-between">
              <Pager onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0}>
                ← Précédents
              </Pager>
              <span className="text-[13px]" style={{ color: C.LOW }}>
                {from}–{to} sur {nf.format(total)}
              </span>
              <Pager onClick={() => setOffset((o) => o + PAGE)} disabled={to >= total}>
                Suivants →
              </Pager>
            </div>
          )}
        </Surface>
      </div>
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
      className={`px-2 pb-3 text-[12px] font-medium ${right ? 'text-right' : 'text-left'}`}
      style={{ color: C.LOW }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-3 text-right tabular-nums" style={{ color: C.MID }}>{children}</td>;
}

function Pager({ children, onClick, disabled }: {
  children: React.ReactNode; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition-colors duration-150 disabled:opacity-30"
      style={{ borderColor: C.LINE, color: C.MID }}
    >
      {children}
    </button>
  );
}
