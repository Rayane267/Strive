export default function InstrumentCluster() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      {/* Main cluster panel */}
      <div className="relative overflow-hidden rounded-[2rem] border border-line bg-gradient-to-b from-ink-2 to-ink p-7 shadow-[0_50px_120px_-30px_rgba(0,230,118,0.35)]">
        {/* top status bar */}
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal animate-ring" />
            Live scan
          </span>
          <span>UBER · 18,40 €</span>
        </div>

        {/* Gauge */}
        <div className="relative mx-auto mt-6 h-[200px] w-[260px]">
          {/* colored arc ring */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: '9999px',
              background:
                'conic-gradient(from 215deg, #ff5a4d 0deg, #ffc24b 120deg, #00e676 240deg, transparent 270deg)',
              WebkitMask:
                'radial-gradient(circle at 50% 50%, transparent 66%, #000 67%, #000 92%, transparent 93%)',
              mask: 'radial-gradient(circle at 50% 50%, transparent 66%, #000 67%, #000 92%, transparent 93%)',
              filter: 'saturate(1.1)',
            }}
          />
          {/* tick marks */}
          {Array.from({ length: 19 }).map((_, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-1/2 h-[8px] w-[2px] origin-[center_-86px] rounded-full bg-fg/15"
              style={{ transform: `rotate(${-135 + i * 15}deg) translateY(-86px)` }}
            />
          ))}
          {/* needle */}
          <div className="gauge-needle absolute left-1/2 top-1/2 h-[92px] w-[3px] -translate-x-1/2 -translate-y-full rounded-full bg-signal shadow-[0_0_14px_rgba(0,230,118,0.8)]" />
          <span className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-signal bg-ink" />

          {/* center readout */}
          <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Taux horaire</span>
            <span className="font-mono text-5xl font-bold leading-none text-signal text-signal-glow">34</span>
            <span className="font-mono text-xs text-muted">€ / heure</span>
          </div>
        </div>

        {/* Verdict */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-signal/30 bg-signal/8 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-signal text-[#05140c]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-base font-bold leading-tight text-signal">PRENDRE</p>
              <p className="text-[11px] text-muted">Au-dessus de tes deux seuils</p>
            </div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint">2.0s</span>
        </div>

        {/* Metric readouts */}
        <div className="mt-3 grid grid-cols-3 gap-2.5 font-mono">
          {[
            { v: '1,82', l: '€/km' },
            { v: '12,4', l: 'km' },
            { v: '18,40', l: 'total €' },
          ].map((m) => (
            <div key={m.l} className="rounded-xl border border-line bg-canvas/60 px-2 py-3 text-center">
              <div className="text-lg font-bold text-fg">{m.v}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-widest text-faint">{m.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating chips */}
      <div className="animate-float absolute -left-6 top-28 hidden rounded-xl border border-line bg-ink/90 px-3.5 py-2.5 backdrop-blur sm:block">
        <p className="font-mono text-[9px] uppercase tracking-widest text-faint">Refusées auj.</p>
        <p className="font-display text-sm font-bold text-danger">−4 pièges</p>
      </div>
      <div
        className="animate-float absolute -right-5 bottom-24 hidden rounded-xl border border-line bg-ink/90 px-3.5 py-2.5 backdrop-blur sm:block"
        style={{ animationDelay: '1.4s' }}
      >
        <p className="font-mono text-[9px] uppercase tracking-widest text-faint">Gain net</p>
        <p className="font-display text-sm font-bold text-amber">+62 € évités</p>
      </div>
    </div>
  );
}
