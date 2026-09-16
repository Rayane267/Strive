'use client';

import { FAILURE, ago, fmt } from './types';
import { useFeed } from './data';
import { Bars, Card, Empty, Pill, Stat } from './ui';

const nf = new Intl.NumberFormat('fr-FR');

/** Qui est en cause. « Quota atteint » et « scanner coupé » sont de vrais
 *  échecs, mais il n'y a rien à corriger : les mélanger aux pannes d'OCR
 *  gonflait un chiffre qu'on ne pouvait plus lire. */
const BLAME = {
  app:    { label: 'app',       color: '#FF5A4D' },
  user:   { label: 'chauffeur', color: '#8B958E' },
  source: { label: 'capture',   color: '#FFC24B' },
} as const;

export default function ErrorsView({ days }: { days: number }) {
  const { data: feed, err } = useFeed(days, 25);

  if (err) return <p role="alert" className="p-8 text-center text-sm text-[#FF5A4D]">{err}</p>;
  if (!feed) return <p className="p-8 text-center text-sm text-white/40">Chargement…</p>;

  const all = feed.failures_by_reason.reduce((s, r) => s + r.total, 0);
  const app = feed.failures_by_reason
    .filter((r) => (FAILURE[r.reason]?.blame ?? 'app') === 'app')
    .reduce((s, r) => s + r.total, 0);
  const maxReason = Math.max(1, ...feed.failures_by_reason.map((x) => x.total));
  const worstVersion = feed.failures_by_version[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Taux d'échec"
          value={feed.failure_rate != null ? `${String(feed.failure_rate).replace('.', ',')} %` : '—'}
          sub={`sur ${feed.window_days} jours`}
          hint="Échecs rapportés / (échecs + scans aboutis). Un scan raté n'entre jamais dans scan_events : les deux tables se complètent au lieu de se recouper."
        />
        <Stat
          label="Imputables à l'app"
          value={nf.format(app)}
          sub={all > 0 ? `sur ${nf.format(all)} échecs · ${Math.round((app / all) * 100)} %` : 'aucun échec'}
          hint="Le reste vient du chauffeur (quota, scanner coupé) ou de la capture elle-même : rien à corriger côté code."
        />
        <Stat
          label="Motif dominant"
          value={feed.failures_by_reason[0]
            ? (FAILURE[feed.failures_by_reason[0].reason]?.label ?? feed.failures_by_reason[0].reason)
            : '—'}
          sub={feed.failures_by_reason[0] ? `${nf.format(feed.failures_by_reason[0].total)} occurrences` : ''}
        />
        <Stat
          label="Version la plus touchée"
          value={worstVersion?.app_version ?? '—'}
          sub={worstVersion ? `${nf.format(worstVersion.total)} échecs · ${worstVersion.users} chauffeurs` : ''}
          hint="Un motif concentré sur une seule version n'est pas un problème de terrain, c'est une livraison."
        />
      </div>

      <Card
        title="Échecs par jour"
        subtitle="Barre pleine : les échecs. Trace claire derrière : les scans aboutis du même jour."
      >
        <Bars
          rows={feed.failures_daily.map((d) => ({ day: d.day, value: d.failures, ghost: d.scans }))}
          color="#FF5A4D"
          unit="échec"
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <Card
          title="Dernières erreurs"
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
          <Card title="Par motif" subtitle={`Sur ${feed.window_days} jours`}>
            {feed.failures_by_reason.length === 0 ? (
              <Empty>Aucun échec.</Empty>
            ) : (
              <ul className="space-y-2">
                {feed.failures_by_reason.map((r) => {
                  const meta = FAILURE[r.reason] ?? { label: r.reason, blame: 'app' as const };
                  return (
                    <li key={r.reason} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-white/70">{meta.label}</span>
                        <span className="tabular-nums text-white">{nf.format(r.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(r.total / maxReason) * 100}%`, background: BLAME[meta.blame].color }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Par version" subtitle="La colonne qui désigne une régression">
            {feed.failures_by_version.length === 0 ? (
              <Empty>Aucun échec.</Empty>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {feed.failures_by_version.map((v) => (
                  <li key={v.app_version} className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-white/70">{v.app_version}</span>
                    <span className="tabular-nums text-white">
                      {nf.format(v.total)}
                      <span className="ml-2 text-white/35">
                        {v.users} chauffeur{v.users > 1 ? 's' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {feed.audit_recent.length > 0 && (
        <Card
          title="Journal des comptes"
          subtitle="L'audit hors RevenueCat : suppressions, garde-fous déclenchés"
        >
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
