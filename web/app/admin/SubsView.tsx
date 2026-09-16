'use client';

import { SUB_EVENT, TIER, ago, eur, fmt, type Tier } from './types';
import { PRODUCT_LABEL, mrrFrom, useAnalytics, useFeed } from './data';
import { Bars, Card, Empty, Pill, Stat } from './ui';

const nf = new Intl.NumberFormat('fr-FR');
const TONE = { good: '#00E676', warn: '#FFC24B', bad: '#FF5A4D', flat: '#8B958E' } as const;

export default function SubsView({ days }: { days: number }) {
  const { data: feed, err } = useFeed(days, 25);
  const { data: stats } = useAnalytics(days);

  if (err) return <p role="alert" className="p-8 text-center text-sm text-[#FF5A4D]">{err}</p>;
  if (!feed) return <p className="p-8 text-center text-sm text-white/40">Chargement…</p>;

  const { mrr, unknown } = mrrFrom(feed.subs_active_by_product);
  const active = feed.subs_active_by_product.reduce((s, r) => s + r.total, 0);
  const subs = stats?.subscriptions;
  const maxType = Math.max(1, ...feed.subs_by_type.map((x) => x.total));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenu mensualisé"
          value={eur(mrr)}
          sub={unknown > 0
            ? `${unknown} abonnement${unknown > 1 ? 's' : ''} sans produit connu`
            : `${nf.format(active)} abonnements en cours`}
          hint="Abonnements actifs et en période de grâce, chaque annuel compté pour un douzième. Prix de vente : ni la commission des stores ni la TVA ne sont déduites."
        />
        <Stat
          label="Plus"
          value={subs ? nf.format(subs.plus) : '—'}
          sub={subs ? `${nf.format(subs.active)} actifs au total` : ''}
        />
        <Stat
          label="Premium"
          value={subs ? nf.format(subs.premium) : '—'}
          sub={subs ? `${nf.format(subs.grace)} en période de grâce` : ''}
        />
        <Stat
          label="Résiliations"
          value={subs ? nf.format(subs.cancelled) : '—'}
          sub={`sur ${days} jours : ${nf.format(
            feed.subs_by_type.find((t) => t.event_type === 'CANCELLATION')?.total ?? 0,
          )} déclarées`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <Card
          title="Derniers mouvements"
          subtitle="Webhooks RevenueCat, du plus récent au plus ancien"
        >
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
          <Card title="Par type" subtitle={`Sur ${feed.window_days} jours`}>
            {feed.subs_by_type.length === 0 ? (
              <Empty>Rien sur la période.</Empty>
            ) : (
              <ul className="space-y-2">
                {feed.subs_by_type.map((r) => {
                  const meta = SUB_EVENT[r.event_type] ?? { label: r.event_type, tone: 'flat' as const };
                  return (
                    <li key={r.event_type} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-white/70">{meta.label}</span>
                        <span className="tabular-nums text-white">{nf.format(r.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(r.total / maxType) * 100}%`, background: TONE[meta.tone] }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="En cours" subtitle="Par produit, et ce qu'il rapporte par mois">
            {feed.subs_active_by_product.length === 0 ? (
              <Empty>Aucun abonnement actif.</Empty>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {feed.subs_active_by_product.map((r) => {
                  const { mrr: line } = mrrFrom([r]);
                  return (
                    <li key={r.product_id} className="flex items-baseline justify-between gap-3">
                      <span className="text-white/70">{PRODUCT_LABEL[r.product_id] ?? r.product_id}</span>
                      <span className="tabular-nums text-white">
                        {nf.format(r.total)}
                        {line > 0 && <span className="ml-2 text-white/35">{eur(line)}/mois</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

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
                <Pill
                  label={TIER[s.tier as Tier]?.label ?? s.tier}
                  color={TIER[s.tier as Tier]?.color ?? '#6B7280'}
                  dim
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Inscriptions par jour" subtitle={`Sur ${feed.window_days} jours`}>
        <Bars
          rows={feed.signups_daily.map((d) => ({ day: d.day, value: d.signups }))}
          color="#A855F7"
          unit="inscription"
        />
      </Card>
    </div>
  );
}
