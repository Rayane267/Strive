export default function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[280px] sm:w-[320px]">
      {/* Phone frame */}
      <div className="relative rounded-[2.75rem] border border-white/10 bg-[#05140c] p-3 shadow-[0_40px_120px_-20px_rgba(0,230,118,0.35)]">
        <div className="relative overflow-hidden rounded-[2.25rem] bg-gradient-to-b from-surface to-background">
          {/* Dynamic Island */}
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full bg-black px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
              <span className="text-[11px] font-bold text-primary">PRENDRE</span>
            </div>
          </div>

          {/* Screen content */}
          <div className="px-5 pb-7 pt-16">
            <p className="text-center text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Verdict instantané
            </p>

            {/* Big verdict */}
            <div className="glow-border mt-4 rounded-2xl bg-surface-light/60 p-5 text-center">
              <div className="text-5xl font-black text-primary drop-shadow-[0_0_20px_rgba(0,230,118,0.6)]">
                ✓
              </div>
              <p className="mt-1 text-lg font-extrabold">Course rentable</p>
              <p className="mt-1 text-xs text-text-muted">
                Les deux métriques dépassent tes seuils
              </p>
            </div>

            {/* Metrics */}
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {[
                { v: '34€', l: '€/h' },
                { v: '1,82€', l: '€/km' },
                { v: '18,40€', l: 'Total' },
              ].map((m) => (
                <div key={m.l} className="rounded-xl bg-surface/80 px-2 py-3 text-center">
                  <div className="text-base font-extrabold text-text-main">{m.v}</div>
                  <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    {m.l}
                  </div>
                </div>
              ))}
            </div>

            {/* Source apps */}
            <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-text-dimmed">
              <span>Détecté depuis</span>
              <span className="rounded-md bg-surface px-2 py-0.5 font-semibold text-text-muted">Uber</span>
              <span className="rounded-md bg-surface px-2 py-0.5 font-semibold text-text-muted">Bolt</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating mini-cards */}
      <div className="animate-float absolute -left-10 top-24 hidden rounded-2xl glass px-4 py-3 sm:block">
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Scan</p>
        <p className="text-sm font-bold text-primary">2 secondes</p>
      </div>
      <div
        className="animate-float absolute -right-8 bottom-28 hidden rounded-2xl glass px-4 py-3 sm:block"
        style={{ animationDelay: '1.5s' }}
      >
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Aujourd&apos;hui</p>
        <p className="text-sm font-bold text-text-main">+62€ évités</p>
      </div>
    </div>
  );
}
