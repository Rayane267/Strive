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
