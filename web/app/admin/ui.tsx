/* ──────────────────────────────────────────────────────────────────────────
   Primitives partagées de la console. Extraites d'AnalyticsView quand les
   vues Chauffeurs et Fiche ont eu besoin des mêmes tuiles : trois copies de
   la même carte auraient dérivé à la première retouche de la palette.
   ────────────────────────────────────────────────────────────────────────── */

/** Tuile chiffre. `hint` va en `title` : la nuance longue sans alourdir. */
export function Stat({ label, value, sub, hint }: {
  label: string; value: string; sub?: string; hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0F1311] p-5" title={hint}>
      <p className="text-xs uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-white/45">{sub}</p>}
    </div>
  );
}

export function Card({ title, subtitle, children, aside }: {
  title: string; subtitle?: string; children: React.ReactNode; aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#0F1311] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Pastille de statut. La couleur ne porte jamais l'information seule : le
 *  libellé est toujours écrit à côté. */
export function Pill({ label, color, dim = false }: {
  label: string; color: string; dim?: boolean;
}) {
  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: color + (dim ? '14' : '22'), color }}
    >
      {label}
    </span>
  );
}

/** Point vert « en ligne », avec halo animé. Décoratif : le texte à côté dit
 *  la même chose, et l'animation se coupe pour qui a demandé moins de
 *  mouvement (prefers-reduced-motion, géré par la classe `motion-safe`). */
export function OnlineDot({ stale = false }: { stale?: boolean }) {
  const color = stale ? '#FFC24B' : '#00E676';
  return (
    <span className="relative flex h-2 w-2 flex-none" aria-hidden>
      {!stale && (
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
          style={{ background: color }}
        />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

/** Ligne d'étiquette et valeur, pour les fiches. */
export function Field({ label, value, mono = false }: {
  label: string; value: React.ReactNode; mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 last:border-0">
      <span className="flex-none text-xs uppercase tracking-wide text-white/45">{label}</span>
      <span className={`text-right text-sm text-white/90 ${mono ? 'font-mono text-xs' : ''}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-white/40">{children}</p>;
}

/** Colonnes journalières sans axe ni grille : à cette taille, le graphe ne
 *  sert qu'à lire un rythme — un trou, une reprise, un pic. La valeur exacte
 *  est dans l'infobulle, jamais devinée à l'œil. */
export function Bars({ rows, color, unit }: {
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
          className="relative h-full flex-1"
          title={
            `${new Date(r.day).toLocaleDateString('fr-FR')} — ${r.value} ${unit}${r.value > 1 ? 's' : ''}` +
            (r.ghost != null ? ` · ${r.ghost} scan${r.ghost > 1 ? 's' : ''}` : '')
          }
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

/* ──────────────────────────────────────────────────────────────────────────
   Échelle de texte et matériau, partagés par toute la console.
   Mesurés sur le verre du champ (≈ #141F19) :
     FG  14,8:1 — le chiffre, et lui seul, prend le maximum
     MID  7,9:1 — libellés, lignes de liste, en-têtes de colonne
     LOW  4,9:1 — appuis. C'est le plancher, jamais en dessous.
   L'ancien #5B655E tombait à 2,8:1 : illisible, il ne sert plus qu'aux traits.
   ────────────────────────────────────────────────────────────────────────── */
export const C = {
  FG: '#F2F7F4',
  MID: '#B6C1BA',
  LOW: '#8B958E',
  LINE: 'rgba(233,245,238,0.09)',
  SIGNAL: '#00E676',
  WARN: '#FFC24B',
  BAD: '#FF5A4D',
} as const;

/** Le panneau. Fond plat #0F1311 et filet d'un pixel : exactement la
 *  surface des pages Activité et Abonnements, reprise partout. Le champ
 *  lumineux dégradé a été essayé puis écarté — il éclaircissait le bas de
 *  page et délavait les panneaux qui s'y trouvaient.
 *
 *  `depth` est conservé dans la signature mais n'a plus d'effet : toutes les
 *  surfaces de la console sont au même niveau, et c'est le contraste du
 *  texte qui porte la hiérarchie, pas la clarté du fond. */
export function Surface({ children, className = '' }: {
  children: React.ReactNode; depth?: 0 | 1 | 2; className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-[#0F1311] p-6 ${className}`}>
      {children}
    </div>
  );
}

/** Tuile chiffre du même matériau. `lead` donne la dominance : la taille est
 *  la hiérarchie, pas la couleur. */
export function Metric({ label, value, unit, sub, tone, depth = 0, lead = false }: {
  label: string; value: string; unit?: string; sub?: React.ReactNode;
  tone?: string; depth?: 0 | 1 | 2; lead?: boolean;
}) {
  return (
    <Surface depth={depth}>
      <p className="text-[13px] font-medium" style={{ color: C.MID }}>{label}</p>
      <p className="mt-2 flex items-baseline gap-2.5">
        <span
          className={`font-semibold leading-none tracking-[-0.035em] tabular-nums ${lead ? 'text-[3.25rem]' : 'text-[2.25rem]'}`}
          style={{ color: tone ?? C.FG }}
        >
          {value}
        </span>
        {unit && <span className="text-sm" style={{ color: C.MID }}>{unit}</span>}
      </p>
      {sub && <p className="mt-2.5 text-sm leading-relaxed" style={{ color: C.LOW }}>{sub}</p>}
    </Surface>
  );
}
