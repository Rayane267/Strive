'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { planById } from '../data/plans';
import {
  FAILURE, SUB_EVENT, TIER, ago, eur, fmt,
  type Feed, type Tier,
} from './types';
import { Card, Pill, Stat } from './ui';

const nf = new Intl.NumberFormat('fr-FR');

/* Revenu mensualisé : les prix ne sont PAS recopiés ici. Ils viennent de
   `app/data/plans.ts`, la même source que les cartes tarifaires — et donc la
   même que la grille App Store. Un annuel compte pour un douzième : c'est ce
   qu'il rapporte par mois, pas ce qu'il a encaissé d'un coup. */
function monthlyValue(productId: string): number | null {
  const plus = planById('plus');
  const premium = planById('premium');
  switch (productId) {
    case 'strive_plus_monthly':    return plus.amount.monthly;
    case 'strive_plus_yearly':     return plus.amount.yearly / 12;
    case 'strive_premium_monthly': return premium.amount.monthly;
    case 'strive_premium_yearly':  return premium.amount.yearly / 12;
    default:                       return null;
  }
}

const PRODUCT_LABEL: Record<string, string> = {
  strive_plus_monthly:    'Plus · mensuel',
  strive_plus_yearly:     'Plus · annuel',
  strive_premium_monthly: 'Premium · mensuel',
  strive_premium_yearly:  'Premium · annuel',
};

const TONE = { good: '#00E676', warn: '#FFC24B', bad: '#FF5A4D', flat: '#8B958E' } as const;
const BLAME = {
  app:    { label: 'app',      color: '#FF5A4D' },
  user:   { label: 'chauffeur', color: '#8B958E' },
  source: { label: 'capture',  color: '#FFC24B' },
} as const;

export default function FeedView({ days }: { days: number }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('admin_feed', { p_days: days, p_limit: 25 }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else { setErr(''); setFeed(data as Feed); }
    });
    return () => { cancelled = true; };
  }, [days]);

  if (err) {
    return (
      <Card title="Flux récents">
        <p role="alert" className="text-sm text-[#FF5A4D]">{err}</p>
      </Card>
    );
  }
  if (!feed) {
    return (
      <Card title="Flux récents">
        <p className="text-sm text-white/40">Chargement…</p>
      </Card>
    );
  }

  // Revenu mensualisé estimé : somme des abonnements en cours ramenés au mois.
  let mrr = 0;
  let mrrUnknown = 0;
  for (const r of feed.subs_active_by_product) {
    const v = monthlyValue(r.product_id);
    if (v == null) mrrUnknown += r.total;
    else mrr += v * r.total;
  }

  const act = feed.activation;
  const appFailures = feed.failures_by_reason
    .filter((r) => (FAILURE[r.reason]?.blame ?? 'app') === 'app')
    .reduce((s, r) => s + r.total, 0);
  const allFailures = feed.failures_by_reason.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-6">

      {/* ── Chiffres du flux ─────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenu mensualisé"
          value={eur(Math.round(mrr * 100) / 100)}
          sub={
            mrrUnknown > 0
              ? `${mrrUnknown} abonnement${mrrUnknown > 1 ? 's' : ''} sans produit connu`
              : `${nf.format(feed.subs_active_by_product.reduce((s, r) => s + r.total, 0))} abonnements en cours`
          }
          hint="Abonnements actifs et en période de grâce, chaque annuel compté pour un douzième. Prix de vente : la commission des stores et la TVA ne sont pas déduites."
        />
        <Stat
          label="Taux d'échec des scans"
          value={feed.failure_rate != null ? `${String(feed.failure_rate).replace('.', ',')} %` : '—'}
          sub={
            allFailures > 0
              ? `${nf.format(appFailures)} sur ${nf.format(allFailures)} imputables à l'app`
              : 'aucun échec sur la période'
          }
          hint="Échecs rapportés / (échecs + scans aboutis). Un scan raté n'apparaît pas dans scan_events : les deux tables se complètent."
        />
        <Stat
          label="Activation"
          value={act.signups > 0 ? `${Math.round((act.scanned / act.signups) * 100)} %` : '—'}
          sub={`${nf.format(act.scanned)} des ${nf.format(act.signups)} inscrits ont scanné · ${nf.format(act.paid)} ont payé`}
          hint="Un compte créé qui n'a jamais scanné est un téléchargement, pas un utilisateur."
        />
        <Stat
          label="Liste d'attente"
          value={nf.format(feed.waitlist.total)}
          sub={`+${nf.format(feed.waitlist.window)} sur la période`}
        />
      </div>

      {/* ── Abonnements ──────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <Card title="Derniers mouvements d'abonnement" subtitle="Webhooks RevenueCat, du plus récent au plus ancien">
          {feed.subs_recent.length === 0 ? (
            <Empty>Aucun mouvement enregistré.</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {feed.subs_recent.map((s, i) => {
                const meta = SUB_EVENT[s.event_type ?? ''] ?? { label: s.event_type ?? '—', tone: 'flat' as const };
                return (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="flex-none text-xs tabular-nums text-white/35" title={fmt(s.created_at)}>
                      {ago(s.created_at)}
                    </span>
                    <span className="flex-none font-semibold" style={{ color: TONE[meta.tone] }}>
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-white/70">{s.email ?? '—'}</span>
                    <span className="flex-none text-xs text-white/45">
                      {s.product_id ? (PRODUCT_LABEL[s.product_id] ?? s.product_id) : '—'}
                    </span>
                    <Pill label={TIER[s.tier_now].label} color={TIER[s.tier_now].color} dim />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Mouvements par type" subtitle={`Sur ${feed.window_days} jours`}>
            {feed.subs_by_type.length === 0 ? (
              <Empty>Rien sur la période.</Empty>
            ) : (
              <ul className="space-y-2">
                {feed.subs_by_type.map((r) => {
                  const meta = SUB_EVENT[r.event_type] ?? { label: r.event_type, tone: 'flat' as const };
                  const max = Math.max(...feed.subs_by_type.map((x) => x.total));
                  return (
                    <li key={r.event_type} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-white/70">{meta.label}</span>
                        <span className="tabular-nums text-white">{nf.format(r.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(r.total / max) * 100}%`, background: TONE[meta.tone] }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Abonnements en cours" subtitle="Par produit">
            {feed.subs_active_by_product.length === 0 ? (
              <Empty>Aucun abonnement actif.</Empty>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {feed.subs_active_by_product.map((r) => (
                  <li key={r.product_id} className="flex items-baseline justify-between gap-3">
                    <span className="text-white/70">
                      {PRODUCT_LABEL[r.product_id] ?? r.product_id}
                    </span>
                    <span className="tabular-nums text-white">
                      {nf.format(r.total)}
                      {monthlyValue(r.product_id) != null && (
                        <span className="ml-2 text-white/35">
                          {eur(Math.round(monthlyValue(r.product_id)! * r.total * 100) / 100)}/mois
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── Échéances ────────────────────────────────────────────────── */}
      {feed.subs_expiring.length > 0 && (
        <Card
          title="Échéances sous 30 jours"
          subtitle="Se renouvelleront, ou retomberont en gratuit si le paiement échoue"
        >
          <ul className="divide-y divide-white/5">
            {feed.subs_expiring.map((s) => (
              <li key={s.user_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="flex-none text-xs tabular-nums text-white/45">{fmt(s.expires_at)}</span>
                <span className="min-w-0 flex-1 truncate text-white/70">{s.email ?? s.user_id}</span>
                {s.status && s.status !== 'active' && (
                  <span className="flex-none text-[10px] uppercase text-[#FFC24B]">{s.status}</span>
                )}
                <Pill label={TIER[s.tier as Tier]?.label ?? s.tier} color={TIER[s.tier as Tier]?.color ?? '#6B7280'} dim />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Erreurs ──────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <Card
          title="Dernières erreurs de scan"
          subtitle="Motif normalisé à l'écriture — « autre » conserve le brut dans le détail"
        >
          {feed.failures_recent.length === 0 ? (
            <Empty>Aucune erreur rapportée.</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {feed.failures_recent.map((f, i) => {
                const meta = FAILURE[f.reason] ?? { label: f.reason, blame: 'app' as const };
                return (
                  <li key={i} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="flex-none text-xs tabular-nums text-white/35" title={fmt(f.at)}>
                        {ago(f.at)}
                      </span>
                      <span className="flex-none font-semibold text-white/90">{meta.label}</span>
                      <Pill label={BLAME[meta.blame].label} color={BLAME[meta.blame].color} dim />
                      <span className="min-w-0 flex-1 truncate text-xs text-white/50">{f.email ?? '—'}</span>
                      <span className="flex-none text-xs text-white/35">
                        {[f.os, f.surface, f.platform, f.app_version].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                    {f.detail && (
                      <p className="mt-1 truncate font-mono text-[11px] text-white/35" title={f.detail}>
                        {f.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Échecs par motif" subtitle={`Sur ${feed.window_days} jours`}>
            {feed.failures_by_reason.length === 0 ? (
              <Empty>Aucun échec.</Empty>
            ) : (
              <ul className="space-y-2">
                {feed.failures_by_reason.map((r) => {
                  const meta = FAILURE[r.reason] ?? { label: r.reason, blame: 'app' as const };
                  const max = Math.max(...feed.failures_by_reason.map((x) => x.total));
                  return (
                    <li key={r.reason} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-white/70">{meta.label}</span>
                        <span className="tabular-nums text-white">{nf.format(r.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(r.total / max) * 100}%`, background: BLAME[meta.blame].color }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card
            title="Échecs par version"
            subtitle="Un motif concentré sur une version est une régression, pas du terrain"
          >
            {feed.failures_by_version.length === 0 ? (
              <Empty>Aucun échec.</Empty>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {feed.failures_by_version.map((v) => (
                  <li key={v.app_version} className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-white/70">{v.app_version}</span>
                    <span className="tabular-nums text-white">
                      {nf.format(v.total)}
                      <span className="ml-2 text-white/35">{v.users} chauffeur{v.users > 1 ? 's' : ''}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── Rythmes ──────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Inscriptions par jour" subtitle={`Sur ${feed.window_days} jours`}>
          <Bars
            rows={feed.signups_daily.map((d) => ({ day: d.day, value: d.signups }))}
            color="#3987e5"
            unit="inscription"
          />
        </Card>
        <Card
          title="Échecs par jour"
          subtitle="Barre pleine : les échecs. Trace claire : les scans aboutis du même jour."
        >
          <Bars
            rows={feed.failures_daily.map((d) => ({ day: d.day, value: d.failures, ghost: d.scans }))}
            color="#FF5A4D"
            unit="échec"
          />
        </Card>
      </div>

      {/* ── Audit ────────────────────────────────────────────────────── */}
      {feed.audit_recent.length > 0 && (
        <Card title="Journal des comptes" subtitle="Tout l'audit hors RevenueCat : suppressions, garde-fous déclenchés">
          <ul className="divide-y divide-white/5">
            {feed.audit_recent.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="flex-none text-xs tabular-nums text-white/35" title={fmt(a.created_at)}>
                  {ago(a.created_at)}
                </span>
                <span className="flex-none font-mono text-xs text-white/80">{a.action}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-white/50">{a.email ?? '—'}</span>
                {a.details != null && (
                  <span
                    className="max-w-[18rem] flex-none truncate font-mono text-[11px] text-white/30"
                    title={JSON.stringify(a.details)}
                  >
                    {JSON.stringify(a.details)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Colonnes journalières sans axe ni grille : à cette taille, le graphe ne
 *  sert qu'à lire un rythme — un trou, une reprise, un pic. La valeur exacte
 *  est dans l'infobulle, jamais devinée à l'œil. */
function Bars({ rows, color, unit }: {
  rows: { day: string; value: number; ghost?: number }[];
  color: string;
  unit: string;
}) {
  if (rows.length === 0) return <Empty>Rien sur la période.</Empty>;
  // L'échelle englobe la série de fond : sinon les barres pleines la
  // dépasseraient et la comparaison mentirait.
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.ghost ?? 0)));
  return (
    <div className="flex h-24 items-end gap-[2px]">
      {rows.map((r) => (
        <div
          key={r.day}
          className="relative flex-1"
          style={{ height: '100%' }}
          title={`${new Date(r.day).toLocaleDateString('fr-FR')} — ${r.value} ${unit}${r.value > 1 ? 's' : ''}` +
                 (r.ghost != null ? ` · ${r.ghost} scan${r.ghost > 1 ? 's' : ''}` : '')}
        >
          {r.ghost != null && (
            <span
              className="absolute bottom-0 w-full rounded-sm bg-white/10"
              style={{ height: `${(r.ghost / max) * 100}%` }}
            />
          )}
          <span
            className="absolute bottom-0 w-full rounded-sm"
            style={{
              height: `${Math.max(r.value ? 3 : 1, (r.value / max) * 100)}%`,
              background: color,
              opacity: r.value ? 1 : 0.15,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-white/40">{children}</p>;
}
