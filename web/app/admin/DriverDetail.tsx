'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { STATUS, TIER, ago, eur, fmt, type DriverDetail as Detail } from './types';
import { Field, OnlineDot, Pill } from './ui';

/** Panneau latéral d'un chauffeur. Monté à la demande : la fiche coûte un
 *  aller-retour, on ne la charge pas pour les cinquante lignes de la liste. */
export default function DriverDetail({ id, onClose }: { id: string; onClose: () => void }) {
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

  // Échap ferme : un panneau qui ne se referme qu'à la souris piège le clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label="Fiche chauffeur"
      className="flex w-[26rem] flex-none flex-col border-l border-white/10 bg-[#0B0F0D]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">
            {d?.name ?? d?.email ?? 'Chargement…'}
          </p>
          {d && (
            <p className="truncate text-xs text-white/45">
              {d.name ? d.email : null}
              {d.country ? ` · ${d.country}` : ''}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer la fiche"
          className="flex-none rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white/70 hover:bg-white/15"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {err && <p role="alert" className="text-sm text-[#FF5A4D]">{err}</p>}
        {!d && !err && <p className="text-sm text-white/40">Chargement…</p>}

        {d && (
          <div className="space-y-6">
            {/* ── État ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={TIER[d.subscription.tier].label} color={TIER[d.subscription.tier].color} />
              {d.online.since ? (
                <span className="flex items-center gap-1.5 text-xs text-[#00E676]">
                  <OnlineDot /> en ligne depuis {fmt(d.online.since)}
                </span>
              ) : (
                <span className="text-xs text-white/45">vu {ago(d.last_sign_in_at)}</span>
              )}
              {d.is_admin && <Pill label="Admin" color="#3987e5" />}
            </div>

            {/* ── Activité 30 jours ────────────────────────────────── */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">
                30 derniers jours
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Mini label="Scans" value={String(d.activity_30d.scans)} />
                <Mini
                  label="Courses"
                  value={String(d.activity_30d.rides)}
                  sub={`${d.activity_30d.accepted} prises`}
                />
                <Mini
                  label="Heures en ligne"
                  value={d.activity_30d.hours != null ? `${String(d.activity_30d.hours).replace('.', ',')} h` : '—'}
                />
                <Mini
                  label="Gains"
                  value={eur(d.activity_30d.earnings_eur)}
                  hint="Courses acceptées, consolidées en euros au taux figé de chaque course."
                />
              </div>
              <Spark rows={d.daily} />
            </section>

            {/* ── Abonnement ───────────────────────────────────────── */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">Abonnement</h3>
              <div className="mt-2">
                <Field label="Palier" value={TIER[d.subscription.tier].label} />
                <Field label="Statut" value={d.subscription.status ?? '—'} />
                <Field
                  label="Échéance"
                  value={d.subscription.expires_at ? fmt(d.subscription.expires_at) : '—'}
                />
                <Field label="Produit" value={d.subscription.product_id ?? '—'} mono />
              </div>
            </section>

            {/* ── Quota ────────────────────────────────────────────── */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">
                Quota de scans
              </h3>
              <div className="mt-2">
                <Field
                  label="Aujourd'hui"
                  value={
                    d.quota.stale
                      ? <span className="text-white/45">0 <span className="text-xs">(compteur périmé, remis à zéro à la lecture)</span></span>
                      : String(d.quota.scans_today)
                  }
                />
                <Field label="Crédits achetés" value={String(d.quota.credits)} />
                <Field
                  label="Crédits de bienvenue"
                  value={
                    d.quota.welcome_credits > 0
                      ? `${d.quota.welcome_credits}${d.quota.welcome_expires_at ? ` — expirent le ${fmt(d.quota.welcome_expires_at)}` : ''}`
                      : '—'
                  }
                />
              </div>
            </section>

            {/* ── Véhicule ─────────────────────────────────────────── */}
            {(d.vehicle.make || d.vehicle.model) && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">Véhicule</h3>
                <div className="mt-2">
                  <Field
                    label="Modèle"
                    value={[d.vehicle.make, d.vehicle.model, d.vehicle.year].filter(Boolean).join(' ') || '—'}
                  />
                  <Field label="Carburant" value={d.vehicle.fuel_type ?? '—'} />
                  <Field
                    label="Consommation"
                    value={d.vehicle.avg_cons != null ? String(d.vehicle.avg_cons).replace('.', ',') : '—'}
                  />
                </div>
              </section>
            )}

            {/* ── Compte ───────────────────────────────────────────── */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">Compte</h3>
              <div className="mt-2">
                <Field label="Inscrit le" value={fmt(d.created_at)} />
                <Field
                  label="Dernière connexion"
                  value={d.last_sign_in_at ? fmt(d.last_sign_in_at) : 'jamais'}
                />
                <Field label="Téléphone" value={d.phone ?? '—'} />
                <Field label="Fuseau" value={d.timezone ?? '—'} />
                <Field label="Identifiant" value={d.id} mono />
              </div>
            </section>

            {/* ── Dernières courses ────────────────────────────────── */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">
                20 dernières courses
              </h3>
              {d.recent_rides.length === 0 ? (
                <p className="mt-3 text-sm text-white/40">Aucune course.</p>
              ) : (
                <ul className="mt-2 divide-y divide-white/5">
                  {d.recent_rides.map((r, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-xs">
                      <span className="flex-none text-white/40">{fmt(r.created_at)}</span>
                      <span className="flex-1 truncate text-white/70">
                        {r.platform ?? '—'} ·{' '}
                        <span className={r.status === 'ACCEPTED' ? 'text-[#00E676]' : 'text-white/40'}>
                          {r.status === 'ACCEPTED' ? 'prise' : r.status === 'DECLINED' ? 'refusée' : 'en attente'}
                        </span>
                      </span>
                      <span className="flex-none tabular-nums text-white/80">
                        {money(r.fare_final ?? r.fare_estimated, r.currency)}
                        {r.hourly_rate ? (
                          <span className="text-white/40"> · {money(r.hourly_rate, r.currency)}/h</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Tickets ──────────────────────────────────────────── */}
            {d.tickets.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/45">Support</h3>
                <ul className="mt-2 divide-y divide-white/5">
                  {d.tickets.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-white/80">{t.subject}</span>
                      <Pill label={STATUS[t.status].label} color={STATUS[t.status].color} dim />
                      <span className="flex-none text-white/35">{ago(t.last_message_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
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

function Mini({ label, value, sub, hint }: {
  label: string; value: string; sub?: string; hint?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0F1311] p-3" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-white">{value}</p>
      {sub && <p className="text-[10px] text-white/35">{sub}</p>}
    </div>
  );
}

/** Trente colonnes, une par jour. Pas d'axe ni de grille : à cette taille le
 *  graphe ne sert qu'à lire le rythme — des trous, une reprise, un arrêt. */
function Spark({ rows }: { rows: { day: string; scans: number; rides: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.scans));
  return (
    <div className="mt-3 flex h-12 items-end gap-[2px]" aria-hidden>
      {rows.map((r) => (
        <div
          key={r.day}
          title={`${new Date(r.day).toLocaleDateString('fr-FR')} — ${r.scans} scan(s), ${r.rides} course(s)`}
          className="flex-1 rounded-sm bg-[#3987e5]"
          style={{ height: `${Math.max(2, (r.scans / max) * 100)}%`, opacity: r.scans ? 1 : 0.18 }}
        />
      ))}
    </div>
  );
}
