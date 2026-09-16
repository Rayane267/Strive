'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { STATUS, TIER, ago, eur, fmt, type DriverDetail as Detail } from './types';
import { C, Metric, Surface } from './ui';

/* ──────────────────────────────────────────────────────────────────────────
   La fiche est une PAGE, pas un tiroir. Un panneau de 26 rem sur le côté
   obligeait à lire un abonnement, un quota, un véhicule et vingt courses
   dans une colonne de téléphone, pendant que la liste derrière continuait
   de réclamer l'attention. Ici l'écran ne parle que de ce chauffeur, et le
   retour est explicite.
   ────────────────────────────────────────────────────────────────────────── */

export default function DriverDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setD(null);
    setErr('');
    supabase.rpc('admin_driver', { p_id: id }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setD(data as Detail);
    });
    return () => { cancelled = true; };
  }, [id]);

  // Échap revient à la liste : la page se quitte au clavier comme à la souris.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#0A120E]">
      <div className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[13px] font-semibold outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#00E676]/60"
          style={{ color: C.LOW }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.FG)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.LOW)}
        >
          ← Tous les chauffeurs
        </button>

        {err && <p role="alert" className="text-sm" style={{ color: C.BAD }}>{err}</p>}
        {!d && !err && <p className="text-sm" style={{ color: C.LOW }}>Chargement…</p>}

        {d && (
          <>
            {/* ── Identité ─────────────────────────────────────────────── */}
            <Surface depth={0}>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate text-3xl font-semibold tracking-[-0.02em]" style={{ color: C.FG }}>
                      {d.name ?? d.email ?? 'Chauffeur'}
                    </h1>
                    <Badge label={TIER[d.subscription.tier].label} color={TIER[d.subscription.tier].color} />
                    {d.is_admin && <Badge label="Admin" color="#3987E5" />}
                  </div>
                  <p className="mt-2 text-sm" style={{ color: C.MID }}>
                    {d.name && d.email ? `${d.email} · ` : ''}
                    inscrit le {fmt(d.created_at)}
                    {d.country ? ` · ${d.country}` : ''}
                  </p>
                </div>

                <p className="flex items-center gap-2 text-sm" style={{ color: d.online.since ? C.SIGNAL : C.LOW }}>
                  {d.online.since && (
                    <span className="relative flex h-2 w-2" aria-hidden>
                      <span className="absolute inline-flex h-full w-full rounded-full opacity-70 motion-safe:animate-ping" style={{ background: C.SIGNAL }} />
                      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.SIGNAL }} />
                    </span>
                  )}
                  {d.online.since
                    ? `en ligne depuis ${fmt(d.online.since)}`
                    : `dernière connexion ${ago(d.last_sign_in_at)}`}
                </p>
              </div>
            </Surface>

            {/* ── Trente jours ─────────────────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Scans" value={String(d.activity_30d.scans)} unit="sur 30 j" />
              <Metric
                label="Courses"
                value={String(d.activity_30d.rides)}
                sub={`${d.activity_30d.accepted} prises · ${
                  d.activity_30d.rides > 0
                    ? Math.round((d.activity_30d.accepted / d.activity_30d.rides) * 100)
                    : 0
                } % d'acceptation`}
              />
              <Metric
                label="Heures en ligne"
                value={d.activity_30d.hours != null ? String(d.activity_30d.hours).replace('.', ',') : '—'}
                unit="h"
              />
              <Metric
                label="Gains"
                value={eur(d.activity_30d.earnings_eur)}
                sub="courses acceptées, consolidées en euros"
              />
            </div>

            {/* ── Rythme ───────────────────────────────────────────────── */}
            <Surface depth={1}>
              <p className="text-[13px] font-medium" style={{ color: C.MID }}>Rythme sur 30 jours</p>
              <Rhythm rows={d.daily} />
            </Surface>

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              {/* ── Abonnement ─────────────────────────────────────────── */}
              <Surface depth={1}>
                <h2 className="text-sm font-semibold" style={{ color: C.FG }}>Abonnement</h2>
                <dl className="mt-4">
                  <Row label="Palier" value={TIER[d.subscription.tier].label} />
                  <Row label="Statut" value={d.subscription.status ?? '—'} />
                  <Row label="Échéance" value={d.subscription.expires_at ? fmt(d.subscription.expires_at) : '—'} />
                  <Row label="Produit" value={d.subscription.product_id ?? '—'} mono />
                </dl>
              </Surface>

              {/* ── Quota ──────────────────────────────────────────────── */}
              <Surface depth={1}>
                <h2 className="text-sm font-semibold" style={{ color: C.FG }}>Quota de scans</h2>
                <dl className="mt-4">
                  <Row
                    label="Aujourd'hui"
                    value={
                      d.quota.stale ? (
                        <span style={{ color: C.LOW }}>
                          0 <span className="text-xs">(compteur périmé, lu comme zéro par le serveur)</span>
                        </span>
                      ) : String(d.quota.scans_today)
                    }
                  />
                  <Row label="Crédits achetés" value={String(d.quota.credits)} />
                  <Row
                    label="Crédits de bienvenue"
                    value={
                      d.quota.welcome_credits > 0
                        ? `${d.quota.welcome_credits}${d.quota.welcome_expires_at ? ` — expirent le ${fmt(d.quota.welcome_expires_at)}` : ''}`
                        : '—'
                    }
                  />
                </dl>
              </Surface>

              {/* ── Compte ─────────────────────────────────────────────── */}
              <Surface depth={2}>
                <h2 className="text-sm font-semibold" style={{ color: C.FG }}>Compte</h2>
                <dl className="mt-4">
                  <Row label="Téléphone" value={d.phone ?? '—'} />
                  <Row label="Fuseau" value={d.timezone ?? '—'} />
                  <Row label="Dernière connexion" value={d.last_sign_in_at ? fmt(d.last_sign_in_at) : 'jamais'} />
                  <Row label="Identifiant" value={d.id} mono />
                </dl>
              </Surface>

              {/* ── Véhicule ───────────────────────────────────────────── */}
              <Surface depth={2}>
                <h2 className="text-sm font-semibold" style={{ color: C.FG }}>Véhicule</h2>
                {d.vehicle.make || d.vehicle.model ? (
                  <dl className="mt-4">
                    <Row
                      label="Modèle"
                      value={[d.vehicle.make, d.vehicle.model, d.vehicle.year].filter(Boolean).join(' ') || '—'}
                    />
                    <Row label="Carburant" value={d.vehicle.fuel_type ?? '—'} />
                    <Row
                      label="Consommation"
                      value={d.vehicle.avg_cons != null ? String(d.vehicle.avg_cons).replace('.', ',') : '—'}
                    />
                  </dl>
                ) : (
                  <p className="mt-4 text-sm" style={{ color: C.LOW }}>
                    Aucun véhicule renseigné — le coût carburant n&apos;est donc pas déduit de ses courses.
                  </p>
                )}
              </Surface>
            </div>

            {/* ── Dernières courses ────────────────────────────────────── */}
            <Surface depth={2}>
              <h2 className="text-sm font-semibold" style={{ color: C.FG }}>20 dernières courses</h2>
              {d.recent_rides.length === 0 ? (
                <p className="mt-4 text-sm" style={{ color: C.LOW }}>Aucune course enregistrée.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[34rem] border-collapse text-sm">
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Plateforme</Th>
                        <Th>Décision</Th>
                        <Th right>Tarif</Th>
                        <Th right>€/h</Th>
                        <Th right>Distance</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.recent_rides.map((r, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.LINE}` }}>
                          <Td style={{ color: C.LOW }}>{fmt(r.created_at)}</Td>
                          <Td style={{ color: C.MID }}>{r.platform ?? '—'}</Td>
                          <Td style={{ color: r.status === 'ACCEPTED' ? C.SIGNAL : C.LOW }}>
                            {r.status === 'ACCEPTED' ? 'prise' : r.status === 'DECLINED' ? 'refusée' : 'en attente'}
                          </Td>
                          <Td right style={{ color: C.FG }}>{money(r.fare_final ?? r.fare_estimated, r.currency)}</Td>
                          <Td right style={{ color: C.MID }}>{money(r.hourly_rate, r.currency)}</Td>
                          <Td right style={{ color: C.MID }}>
                            {r.distance_km != null ? `${String(r.distance_km).replace('.', ',')} km` : '—'}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Surface>

            {/* ── Support ──────────────────────────────────────────────── */}
            {d.tickets.length > 0 && (
              <Surface depth={2}>
                <h2 className="text-sm font-semibold" style={{ color: C.FG }}>Support</h2>
                <ul className="mt-2">
                  {d.tickets.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-4 py-2.5 text-sm"
                      style={{ borderTop: `1px solid ${C.LINE}` }}
                    >
                      <span className="min-w-0 flex-1 truncate" style={{ color: C.FG }}>{t.subject}</span>
                      <Badge label={STATUS[t.status].label} color={STATUS[t.status].color} />
                      <span className="flex-none text-[13px]" style={{ color: C.LOW }}>{ago(t.last_message_at)}</span>
                    </li>
                  ))}
                </ul>
              </Surface>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Montant dans la devise de la course, jamais reconverti : le chauffeur a
 *  encaissé ce chiffre-là. La consolidation en euros n'a lieu que dans les
 *  totaux, où elle est annoncée. */
function money(n: number | null, currency: string | null) {
  if (n == null) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF' : '€';
  return `${n.toFixed(2).replace('.', ',')} ${sym}`;
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="flex-none rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
      style={{ background: color + '1F', color }}
    >
      {label}
    </span>
  );
}

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div
      className="flex items-baseline justify-between gap-6 py-2.5"
      style={{ borderTop: `1px solid ${C.LINE}` }}
    >
      <dt className="flex-none text-[13px]" style={{ color: C.LOW }}>{label}</dt>
      <dd className={`text-right text-sm ${mono ? 'font-mono text-xs' : ''}`} style={{ color: C.FG }}>
        {value}
      </dd>
    </div>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`pb-2 text-[12px] font-medium ${right ? 'text-right' : 'text-left'}`}
      style={{ color: C.LOW }}
    >
      {children}
    </th>
  );
}

function Td({ children, right = false, style }: {
  children: React.ReactNode; right?: boolean; style?: React.CSSProperties;
}) {
  return (
    <td className={`py-2.5 ${right ? 'text-right tabular-nums' : ''}`} style={style}>
      {children}
    </td>
  );
}

/** Deux séries par jour : scans en trace, courses en plein. Le survol donne
 *  la valeur exacte — le graphe montre le rythme, il ne le fait pas deviner. */
function Rhythm({ rows }: { rows: { day: string; scans: number; rides: number }[] }) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.scans, r.rides)));
  const shown = at != null ? rows[at] : null;

  return (
    <>
      <div className="mt-4 flex h-24 items-end gap-[3px]" onMouseLeave={() => setAt(null)}>
        {rows.map((r, i) => (
          <div
            key={r.day}
            onMouseEnter={() => setAt(i)}
            className="relative h-full flex-1"
          >
            <span
              className="absolute bottom-0 w-full rounded-t-[3px]"
              style={{
                height: `${Math.max(r.scans ? 4 : 1, (r.scans / max) * 100)}%`,
                background: at === i ? C.SIGNAL : 'rgba(233,245,238,0.22)',
              }}
            />
            <span
              className="absolute bottom-0 w-full rounded-t-[3px]"
              style={{
                height: `${(r.rides / max) * 100}%`,
                background: at === i ? C.SIGNAL : 'rgba(233,245,238,0.55)',
              }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 h-5 text-[13px] tabular-nums" style={{ color: C.MID }}>
        {shown
          ? `${new Date(shown.day).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })} — ${shown.scans} scan${shown.scans > 1 ? 's' : ''}, ${shown.rides} course${shown.rides > 1 ? 's' : ''}`
          : 'Trace claire : les scans. Plein : les courses.'}
      </p>
    </>
  );
}
