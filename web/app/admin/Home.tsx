'use client';

import { useState } from 'react';
import { FAILURE, TIER, ago, dur, eur, type View } from './types';
import { mrrFrom, useAnalytics, useFeed, useLive } from './data';

/* ──────────────────────────────────────────────────────────────────────────
   Accueil de la console, écrit dans la langue visuelle de Strive
   (`docs/DESIGN-LANGUAGE.md`), pas dans un tableau de bord générique.

   · A1/A2 — un seul champ lumineux vertical traverse la page, et chaque
     panneau lit SA position dedans : plus il est bas, plus son verre est
     clair. C'est le point le plus structurel du document, et il n'était
     appliqué nulle part.
   · B6 — le bord n'est pas un trait mais un dégradé d'intensité : chaque
     panneau est une pellicule d'un pixel sur laquelle glisse la lumière.
   · B2 — « le plein doit devenir l'exception ». Aucun aplat de couleur :
     les panneaux sont du verre, la teinte ne touche que le chiffre.
   · C3 — le contraste est réservé au chiffre. Le vert signal ne sort que
     pour ce qui vit maintenant ; l'ambre et le rouge seulement quand il y a
     réellement quelque chose à traiter. Zéro ticket ouvert s'écrit en blanc.
   · E3 — aucune lueur décorative. La seule qui reste est le point de
     présence, et elle porte une information.
   ────────────────────────────────────────────────────────────────────────── */

const SIGNAL = '#00E676';
const WARN = '#FFC24B';
const BAD = '#FF5A4D';

/* Échelle de texte, mesurée sur le verre du champ (≈ #141F19) :
     FG    #F2F7F4  14,8:1  le chiffre, et lui seul, prend le maximum
     MID   #B6C1BA   7,9:1  libellés et lignes de liste
     LOW   #8B958E   4,9:1  appuis — plancher, jamais en dessous
   L'ancien #5B655E tombait à 2,8:1 : c'est ce qui rendait la page illisible.
   Il ne sert plus qu'aux traits, jamais au texte. */
const FG = '#F2F7F4';
const MID = '#B6C1BA';
const LOW = '#8B958E';

const nf = new Intl.NumberFormat('fr-FR');

export default function Home({
  onOpen, onDriver,
}: {
  onOpen: (v: View) => void;
  onDriver: (id: string) => void;
}) {
  const { data: live } = useLive();
  const { data: stats } = useAnalytics(30);
  const { data: feed } = useFeed(30, 6);

  const online = live ? live.drivers.filter((d) => !d.stale) : [];
  const stale = live?.counts.stale ?? 0;

  const failures = feed?.failures_by_reason.reduce((s, r) => s + r.total, 0) ?? null;
  const topReason = feed?.failures_by_reason[0];
  const { mrr, unknown } = feed ? mrrFrom(feed.subs_active_by_product) : { mrr: 0, unknown: 0 };
  const paying = stats ? stats.subscriptions.plus + stats.subscriptions.premium : null;
  const lastSub = feed?.subs_recent[0];

  return (
    // Le champ : gris-vert sombre en haut, qui s'éclaircit vers le bas sans
    // jamais toucher le noir ni le blanc. Les panneaux y sont plongés.
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#0A120E]">
      <div className="mx-auto max-w-7xl p-5 sm:p-8">
        <div className="grid auto-rows-[minmax(10rem,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

          {/* ── Qui roule maintenant ─────────────────────────────────────
              Le seul panneau dont les lignes sont cliquables une par une :
              de l'accueil à la fiche d'un chauffeur en un geste. */}
          <Panel depth={0} span="sm:col-span-2 sm:row-span-2">
            <Head label="En ligne maintenant" live={online.length > 0} />
            <Figure
              value={live ? String(online.length) : '—'}
              unit={online.length > 1 ? 'chauffeurs en ligne' : 'chauffeur en ligne'}
              tone={online.length > 0 ? SIGNAL : undefined}
              lead
            />

            {online.length > 0 ? (
              <ul className="mt-6 flex-1 space-y-0.5">
                {online.slice(0, 7).map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => onDriver(d.id)}
                      className="flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left
                                 outline-none transition-colors duration-150
                                 hover:bg-white/[0.06] focus-visible:bg-white/[0.08]
                                 focus-visible:ring-1 focus-visible:ring-[#00E676]/60"
                    >
                      <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: FG }}>
                        {d.name ?? d.email ?? d.id.slice(0, 8)}
                      </span>
                      <span className="w-16 flex-none text-right text-[13px]" style={{ color: MID }}>
                        {TIER[d.tier].label}
                      </span>
                      <span className="w-16 flex-none text-right text-[13px] tabular-nums" style={{ color: MID }}>
                        {dur(d.minutes)}
                      </span>
                    </button>
                  </li>
                ))}
                {online.length > 7 && (
                  <li className="px-3 pt-1 text-[13px]" style={{ color: LOW }}>
                    et {online.length - 7} autre{online.length - 7 > 1 ? 's' : ''}
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-6 flex-1 text-sm" style={{ color: LOW }}>
                {live ? 'Personne ne roule en ce moment.' : 'Lecture des sessions…'}
              </p>
            )}

            {stale > 0 && (
              <p className="mt-3 text-[13px]" style={{ color: LOW }}>
                <span style={{ color: WARN }}>{stale}</span> session
                {stale > 1 ? 's' : ''} ouverte{stale > 1 ? 's' : ''}{' '}depuis plus de 16 h —
                l&apos;app ne les a pas refermées.
              </p>
            )}

            <Go label="Ouvrir les chauffeurs" onClick={() => onOpen('drivers')} />
          </Panel>

          {/* ── Support ──────────────────────────────────────────────── */}
          <Panel depth={0} onClick={() => onOpen('tickets')}>
            <Head label="Tickets à traiter" />
            <Figure
              value={stats ? String(stats.support.open) : '—'}
              unit={stats && stats.support.open > 1 ? 'ouverts' : 'ouvert'}
              tone={stats && stats.support.open > 0 ? WARN : undefined}
            />
            <Note>
              {stats?.support_first_reply_minutes != null
                ? `1re réponse médiane : ${minutes(stats.support_first_reply_minutes)}`
                : 'aucune réponse sur 30 jours'}
            </Note>
            <Go label="Ouvrir le support" />
          </Panel>

          {/* ── Erreurs ──────────────────────────────────────────────── */}
          <Panel depth={0} onClick={() => onOpen('errors')}>
            <Head label="Erreurs de scan" />
            <Figure
              value={failures != null ? nf.format(failures) : '—'}
              unit="sur 30 jours"
              tone={failures ? BAD : undefined}
            />
            <Note>
              {topReason
                ? `${(FAILURE[topReason.reason]?.label ?? topReason.reason).toLowerCase()} en tête · ${
                    feed?.failure_rate != null ? String(feed.failure_rate).replace('.', ',') : '—'
                  } % des tentatives`
                : 'aucun échec rapporté'}
            </Note>
            <Go label="Ouvrir les erreurs" />
          </Panel>

          {/* ── Parc ─────────────────────────────────────────────────── */}
          <Panel depth={1} onClick={() => onOpen('drivers')}>
            <Head label="Chauffeurs" />
            <Figure value={stats ? nf.format(stats.users.total) : '—'} unit="comptes" />
            <Note>
              {stats
                ? `${nf.format(stats.active_users.window)} actifs sur 30 j · +${nf.format(stats.users.new_7d)} cette semaine`
                : ' '}
            </Note>
            <Go label="Parcourir le parc" />
          </Panel>

          {/* ── Revenu ───────────────────────────────────────────────── */}
          <Panel depth={1} onClick={() => onOpen('subs')}>
            <Head label="Revenu mensualisé" />
            <Figure value={feed ? eur(mrr) : '—'} unit={paying != null ? `${nf.format(paying)} abonnés` : ''} />
            <Note>
              {unknown > 0
                ? `${unknown} abonnement${unknown > 1 ? 's' : ''} sans produit connu`
                : lastSub
                  ? `dernier mouvement ${ago(lastSub.created_at)}`
                  : 'aucun mouvement récent'}
            </Note>
            <Go label="Ouvrir les abonnements" />
          </Panel>

          {/* ── Activité ─────────────────────────────────────────────── */}
          <Panel depth={2} span="sm:col-span-2 lg:col-span-4" onClick={() => onOpen('activity')}>
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <div className="flex-none">
                <Head label="Scans" />
                <Figure value={stats ? nf.format(stats.scans.total) : '—'} unit="sur 30 jours" />
                <Note>
                  {stats ? (
                    <>
                      <Delta rows={stats.scans_daily} />
                      {' · '}
                      {Math.round((stats.scans.both_addresses / Math.max(1, stats.scans.total)) * 100)} %
                      {' '}avec les deux adresses lues
                    </>
                  ) : ' '}
                </Note>
              </div>
              {stats && <Rhythm rows={stats.scans_daily} />}
            </div>
            <Go label="Ouvrir l'activité" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function minutes(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} j`;
}

/* ── Le matériau ─────────────────────────────────────────────────────────
   La surface des pages Activité et Abonnements, reprise ici : fond plat
   #0F1311, filet d'un pixel. Le champ lumineux dégradé a été essayé puis
   écarté — il éclaircissait le bas de page et délavait les panneaux.
   Survol : la surface s'éclaire d'un cran, 150 ms. */
function Panel({
  children, span = '', onClick,
}: {
  children: React.ReactNode; depth?: 0 | 1 | 2; span?: string; onClick?: () => void;
}) {
  const cls = `group flex h-full flex-col rounded-2xl border border-white/10 bg-[#0F1311] p-6
               transition-colors duration-150 ${span}`;

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} cursor-pointer text-left outline-none hover:border-white/20 hover:bg-[#141A17]
                  focus-visible:ring-2 focus-visible:ring-[#00E676]/70 active:scale-[0.996]`}
    >
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function Head({ label, live = false }: { label: string; live?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: MID }}>
      {live && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-70 motion-safe:animate-ping"
            style={{ background: SIGNAL }}
          />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL }} />
        </span>
      )}
      {label}
    </p>
  );
}

/** C1/C3 : le chiffre porte seul le contraste, l'unité recule d'un cran. */
function Figure({ value, unit, tone, lead = false }: {
  value: string; unit?: string; tone?: string; lead?: boolean;
}) {
  return (
    <p className="mt-2 flex items-baseline gap-2.5">
      <span
        className={`font-semibold leading-none tracking-[-0.035em] tabular-nums ${
          lead ? 'text-[4rem]' : 'text-[2.5rem]'
        }`}
        style={{ color: tone ?? FG }}
      >
        {value}
      </span>
      {unit && <span className={lead ? 'text-base' : 'text-sm'} style={{ color: MID }}>{unit}</span>}
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 flex-1 text-sm leading-relaxed" style={{ color: LOW }}>{children}</p>;
}

/** L'appel à l'action recule jusqu'au survol du panneau — c'est le panneau
 *  entier qui est la cible, pas ce libellé. */
function Go({ label, onClick }: { label: string; onClick?: () => void }) {
  const content = (
    <>
      {label}
      <span className="transition-transform duration-150 ease-out group-hover:translate-x-1">→</span>
    </>
  );
  const cls = 'mt-5 flex items-center gap-1.5 text-[13px] font-semibold text-[#8B958E] transition-colors duration-150 group-hover:text-[#F2F7F4]';
  return onClick ? (
    <button
      onClick={onClick}
      className={`${cls} w-fit rounded-lg outline-none hover:text-[#F2F7F4] focus-visible:ring-1 focus-visible:ring-[#00E676]/60`}
    >
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}

/** Sept derniers jours contre les sept precedents. « 1 284 scans » ne dit
 *  rien seul ; ce qu'on lit, c'est le sens de la pente. */
function Delta({ rows }: { rows: { total: number }[] }) {
  if (rows.length < 14) return null;
  const last = rows.slice(-7).reduce((s, r) => s + r.total, 0);
  const prev = rows.slice(-14, -7).reduce((s, r) => s + r.total, 0);
  if (prev === 0) return <span style={{ color: MID }}>{last} cette semaine</span>;
  const pct = Math.round(((last - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span style={{ color: pct === 0 ? MID : up ? SIGNAL : WARN }}>
      {up ? '+' : ''}{pct} % sur 7 jours
    </span>
  );
}

/** Le rythme des trente derniers jours. Chaque colonne réagit au survol et
 *  porte sa valeur : le graphe est lisible, pas décoratif. */
function Rhythm({ rows }: { rows: { day: string; total: number }[] }) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const shown = at != null ? rows[at] : null;

  return (
    <div className="min-w-[14rem] flex-1">
      <div className="flex h-20 items-end gap-[3px]" onMouseLeave={() => setAt(null)}>
        {rows.map((r, i) => (
          <span
            key={r.day}
            onMouseEnter={() => setAt(i)}
            className="min-w-[3px] flex-1 rounded-t-[3px] transition-[opacity,background-color] duration-100"
            style={{
              height: `${Math.max(r.total ? 6 : 2, (r.total / max) * 100)}%`,
              background: at === i ? SIGNAL : 'rgba(233,245,238,0.38)',
              opacity: r.total ? 1 : 0.35,
            }}
          />
        ))}
      </div>
      <p className="mt-2 h-4 text-[13px] tabular-nums" style={{ color: MID }}>
        {shown
          ? `${new Date(shown.day).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — ${shown.total} scan${shown.total > 1 ? 's' : ''}`
          : ''}
      </p>
    </div>
  );
}
