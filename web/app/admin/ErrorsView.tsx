'use client';

import { CAPTURE, FAILURE, ago, fmt, isRefusal, isScanFailure } from './types';
import { useFeed } from './data';
import { Bars, Card, Empty, Pill, Stat } from './ui';

const nf = new Intl.NumberFormat('fr-FR');

/** Qui est en cause. Ce qui vient du chauffeur ou de la capture ne se corrige
 *  pas côté code : le mélanger aux pannes d'OCR gonflait un chiffre qu'on ne
 *  pouvait plus lire. */
const BLAME = {
  app:    { label: 'app',       color: '#FF5A4D' },
  user:   { label: 'chauffeur', color: '#8B958E' },
  source: { label: 'capture',   color: '#FFC24B' },
  // Pas un échec : la course a été mesurée, seule la carte ne l'a pas montrée.
  display: { label: 'affichage', color: '#6FA8DC' },
  // Pas un échec : une règle a bloqué le scan (session, quota, double appui…).
  refusal: { label: 'refus',     color: '#5E6A63' },
} as const;

export default function ErrorsView({ days }: { days: number }) {
  const { data: feed, err } = useFeed(days, 25);

  if (err) return <p role="alert" className="p-8 text-center text-sm text-[#FF5A4D]">{err}</p>;
  if (!feed) return <p className="p-8 text-center text-sm text-white/40">Chargement…</p>;

  // Les incidents d'affichage et les refus sortent de tous les totaux : la
  // course a été mesurée, ou le scan n'a jamais été tenté.
  const reasons = feed.failures_by_reason.filter((r) => isScanFailure(r.reason));
  const refusals = feed.failures_by_reason.filter((r) => isRefusal(r.reason));
  const displayOnly = feed.failures_by_reason
    .filter((r) => FAILURE[r.reason]?.blame === 'display')
    .reduce((s, r) => s + r.total, 0);
  // Tant que 20261017_admin_feed_refusals n'est pas appliquée, le flux mêle
  // encore les refus aux erreurs : on les trie ici.
  const recent = feed.failures_recent.filter((f) => !isRefusal(f.reason));
  const refusalsRecent =
    feed.refusals_recent ?? feed.failures_recent.filter((f) => isRefusal(f.reason));
  const all = reasons.reduce((s, r) => s + r.total, 0);
  // Une « offre illisible » dont la capture n'est pas une offre, ou montre une
  // offre expirée, revient au chauffeur : elle sort du compte de l'app.
  const byCapture = feed.failures_by_capture ?? [];
  const notApp = byCapture
    .filter((c) => c.capture && CAPTURE[c.capture].blame !== 'app')
    .reduce((s, c) => s + c.total, 0);
  const app = reasons
    .filter((r) => (FAILURE[r.reason]?.blame ?? 'app') === 'app')
    .reduce((s, r) => s + r.total, 0) - notApp;
  const maxReason = Math.max(1, ...reasons.map((x) => x.total));
  const worstVersion = feed.failures_by_version[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Taux d'échec"
          value={feed.failure_rate != null ? `${String(feed.failure_rate).replace('.', ',')} %` : '—'}
          sub={`sur ${feed.window_days} jours`}
          hint="Échecs rapportés / (échecs + scans aboutis). Un scan raté n'entre jamais dans scan_events : les deux tables se complètent au lieu de se recouper. Hors scans refusés et cartes non affichées."
        />
        <Stat
          label="Imputables à l'app"
          value={nf.format(app)}
          sub={all > 0 ? `sur ${nf.format(all)} échecs · ${Math.round((app / all) * 100)} %` : 'aucun échec'}
          hint="Le reste vient du chauffeur (langue de son app VTC, écran qui n'est pas une offre, offre expirée) ou de la capture elle-même : rien à corriger côté code. Les scans refusés n'y figurent pas."
        />
        <Stat
          label="Motif dominant"
          value={reasons[0] ? (FAILURE[reasons[0].reason]?.label ?? reasons[0].reason) : '—'}
          sub={reasons[0] ? `${nf.format(reasons[0].total)} occurrences` : ''}
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
          {recent.length === 0 ? (
            <Empty>Aucune erreur rapportée.</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((f, i) => {
                const meta = FAILURE[f.reason] ?? { label: f.reason, blame: 'app' as const };
                // La capture tranche : vraie offre ratée, ou écran du chauffeur.
                const cap = f.capture ? CAPTURE[f.capture] : null;
                const blame = cap?.blame ?? meta.blame;
                return (
                  <li key={i} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="flex-none text-xs tabular-nums text-white/35" title={fmt(f.at)}>
                        {ago(f.at)}
                      </span>
                      <span className="flex-none font-semibold text-white/90">{meta.label}</span>
                      {cap && <span className="flex-none text-xs text-white/55">{cap.label}</span>}
                      <Pill label={BLAME[blame].label} color={BLAME[blame].color} dim />
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
            {reasons.length === 0 ? (
              <Empty>Aucun échec.</Empty>
            ) : (
              <ul className="space-y-2">
                {reasons.map((r) => {
                  const meta = FAILURE[r.reason] ?? { label: r.reason, blame: 'app' as const };
                  const split = byCapture.filter((c) => c.reason === r.reason);
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
                      {split.length > 0 && (
                        <ul className="mt-1.5 space-y-1 pl-3">
                          {split.map((c) => {
                            const cm = c.capture ? CAPTURE[c.capture] : null;
                            return (
                              <li
                                key={c.capture ?? 'none'}
                                className="flex items-baseline justify-between gap-3 text-[11px]"
                              >
                                <span className="flex items-center gap-1.5 text-white/50">
                                  <span
                                    className="h-1.5 w-1.5 flex-none rounded-full"
                                    style={{ background: cm ? BLAME[cm.blame].color : 'rgba(255,255,255,0.2)' }}
                                  />
                                  {cm?.label ?? 'sans capture'}
                                </span>
                                <span className="tabular-nums text-white/70">{nf.format(c.total)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {displayOnly > 0 && (
              <p className="mt-3 border-t border-white/5 pt-3 text-xs text-white/45">
                <span className="tabular-nums text-white/70">{nf.format(displayOnly)}</span>{' '}
                carte{displayOnly > 1 ? 's' : ''} non affichée{displayOnly > 1 ? 's' : ''} — course mesurée,
                verdict envoyé en notification. Hors échecs.
              </p>
            )}
          </Card>

          <Card
            title="Scans refusés"
            subtitle="Pas des échecs : une règle a bloqué le scan avant toute lecture"
          >
            {refusals.length === 0 && refusalsRecent.length === 0 ? (
              <Empty>Aucun refus.</Empty>
            ) : (
              <>
                <ul className="space-y-1.5 text-xs">
                  {refusals.map((r) => (
                    <li key={r.reason} className="flex items-baseline justify-between gap-3">
                      <span className="text-white/70">{FAILURE[r.reason]?.label ?? r.reason}</span>
                      <span className="tabular-nums text-white">{nf.format(r.total)}</span>
                    </li>
                  ))}
                </ul>
                {refusalsRecent.length > 0 && (
                  <ul className="mt-3 divide-y divide-white/5 border-t border-white/5">
                    {refusalsRecent.slice(0, 8).map((f, i) => (
                      <li key={i} className="flex items-baseline gap-x-3 py-1.5 text-xs">
                        <span className="flex-none tabular-nums text-white/35" title={fmt(f.at)}>
                          {ago(f.at)}
                        </span>
                        <span className="flex-none text-white/70">{FAILURE[f.reason]?.label ?? f.reason}</span>
                        <span className="min-w-0 flex-1 truncate text-white/45">{f.email ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
