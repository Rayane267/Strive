// Réplique fidèle de la carte résultat "Live Activity" de l'app iOS
// (cf. StriveLiveActivity.swift → LockScreenView.isResult et le mock du tuto).
// Cas "vert / rentable" : Uber · 37€/h · 24€ · 1,52€/km · 29min · 12,6km.
const VERDICT = '#00E676';

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="#000" aria-hidden>
      <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v1a1 1 0 0 1-2 0v-1H7v1a1 1 0 0 1-2 0v-1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1zm2.2 0h9.6l-1-3H8.2l-1 3zM6.5 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
    </svg>
  );
}

function WalkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="#000" aria-hidden>
      <circle cx="13" cy="4" r="2" />
      <path d="M12.5 8c-1 0-1.8.6-2.2 1.5L8 15l1.8.7 1.5-3.7.9 2.3-2 4.4 1.8.9 2.2-4.7c.3-.7.1-1.5-.5-2l-1.6-1.3 1-2.1c.2-.5 0-1.1-.5-1.3-.4-.2-1 0-1.2.4L11 8.6c-.3-.4-.8-.6-1.3-.6h2.8z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export default function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[280px] sm:w-[320px]">
      {/* Phone frame */}
      <div className="relative rounded-[2.75rem] border border-white/10 bg-[#05140c] p-3 shadow-[0_40px_120px_-20px_rgba(0,230,118,0.35)]">
        <div className="relative overflow-hidden rounded-[2.25rem] bg-gradient-to-b from-surface to-background">
          {/* Dynamic Island — présentation compacte (voiture + €/h) */}
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full bg-black px-3 py-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: VERDICT }}>
                <CarIcon />
              </span>
              <span className="text-[11px] font-extrabold" style={{ color: VERDICT }}>37€/h</span>
            </div>
          </div>

          {/* Screen content */}
          <div className="px-4 pb-7 pt-16">
            <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Verdict instantané
            </p>

            {/* Carte résultat — 1:1 avec la Live Activity de l'app */}
            <div className="rounded-3xl bg-black/95 p-4">
              {/* Ligne du haut : plateforme · €/h · pill prix · €/km */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white/75">Uber</span>
                <span className="flex items-baseline gap-0.5">
                  <span className="text-2xl font-black text-white">€37</span>
                  <span className="text-xs font-semibold text-white/55">/h</span>
                </span>
                <span className="flex-1" />
                <span
                  className="rounded-full border px-2.5 py-1 text-xs font-bold text-white"
                  style={{ background: `${VERDICT}47`, borderColor: `${VERDICT}D9` }}
                >
                  €24
                </span>
                <span className="flex items-center gap-0.5 text-xs font-semibold text-white">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke={VERDICT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                  €1,52/km
                </span>
              </div>

              {/* Ligne trajet : voiture → marche → durée/distance → verdict */}
              <div className="mt-4 flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: VERDICT }}>
                  <CarIcon />
                </span>
                <span className="relative flex-1">
                  <span className="block h-1 w-full rounded-full" style={{ background: `${VERDICT}D9` }} />
                  <span className="absolute left-1/2 top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full" style={{ background: VERDICT }}>
                    <WalkIcon />
                  </span>
                </span>
                <span className="flex flex-col items-end leading-none">
                  <span className="text-sm font-bold text-white">29min</span>
                  <span className="mt-0.5 text-[11px] font-semibold text-white/55">12,6km</span>
                </span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: VERDICT }}>
                  <CheckIcon />
                </span>
              </div>
            </div>

            {/* Verdict + source */}
            <div className="mt-3 flex items-center justify-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: VERDICT }} />
              <span className="text-xs font-extrabold tracking-widest" style={{ color: VERDICT }}>
                COURSE RENTABLE
              </span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-text-dimmed">
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
