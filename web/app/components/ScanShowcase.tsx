'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Vitrine produit scénarisée et interactive :
 *   1. ring  — une offre Uber arrive (la carte « sonne »), le bouton Strive pulse
 *   2. scan  — l'utilisateur appuie → balayage OCR (~1,4 s)
 *   3. done  — la bulle de verdict tombe (€38/h, vert, « prends »)
 * Toujours le même scénario, rejouable. Auto-joue une fois si on n'interagit pas.
 */

type Phase = 'ring' | 'scan' | 'done';
const ACCENT = '#00e676';

// L'offre du scénario (celle du screenshot réel)
const OFFER = {
  category: 'UberX',
  fare: '17,18 €',
  rating: '5,00',
  pickup: { eta: 'à 6 min (1.2 km)', addr: '65 Route de la Libération, 94430 Chennevières-sur-Marne' },
  dest: { course: 'Course de 11.8 km', addr: '16 Rue Charles Pathé, 94300 Vincennes' },
};
const VERDICT = { kmRate: '€1.35/km', hourly: '38', net: '€17', durationMin: '27min', distanceKm: '12.7km' };

export default function ScanShowcase() {
  const [phase, setPhase] = useState<Phase>('ring');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const scan = () => {
    if (phase === 'scan') return;
    clearTimers();
    setPhase('scan');
    timers.current.push(setTimeout(() => setPhase('done'), 1450));
  };

  const replay = () => { clearTimers(); setPhase('ring'); };

  // Réduction de mouvement : on montre direct le verdict. Sinon auto-démo après 2,6 s.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setPhase('done'); return; }
    const t = setTimeout(() => { setPhase((p) => (p === 'ring' ? 'scan' : p)); }, 2600);
    timers.current.push(t);
    return clearTimers;
  }, []);

  // Quand on passe en scan via l'auto-démo, programmer la fin
  useEffect(() => {
    if (phase === 'scan' && timers.current.length <= 1) {
      timers.current.push(setTimeout(() => setPhase('done'), 1450));
    }
  }, [phase]);

  const caption =
    phase === 'ring' ? 'Une course arrive — appuie sur Strive'
    : phase === 'scan' ? 'Analyse de l\'offre…'
    : 'Verdict : prends-la.';

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[300px] sm:w-[336px]">
        <div className="relative rounded-[3rem] border border-white/12 bg-[#05140c] p-2.5 shadow-[0_50px_120px_-30px_rgba(0,0,0,0.9)]">
          <div className="relative aspect-[9/19] overflow-hidden rounded-[2.4rem] bg-[#e9eef3]">
            <Map />

            {/* ── Bulle de verdict (phase done) ── */}
            {phase === 'done' && (
              <div className="showcase-pop absolute inset-x-3 top-3 rounded-[1.4rem] bg-[#0b0d0c] p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-white/90">Uber</span>
                  <span className="flex items-center gap-1 text-[13px] font-bold text-white">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="3"><path d="M7 17L17 7M17 7H9M17 7v8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {VERDICT.kmRate}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-center gap-2">
                  <span className="font-display text-[2rem] font-extrabold leading-none text-white">€{VERDICT.hourly}</span>
                  <span className="text-sm text-white/50">/h</span>
                  <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: 'rgba(0,230,118,0.16)', color: ACCENT, border: `1px solid ${ACCENT}55` }}>{VERDICT.net}</span>
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  <Circle><svg width="13" height="13" viewBox="0 0 24 24" fill="#06140d"><path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-6z" /></svg></Circle>
                  <span className="h-[2px] flex-1 rounded-full" style={{ background: ACCENT, opacity: 0.5 }} />
                  <Circle><svg width="12" height="12" viewBox="0 0 24 24" fill="#06140d"><circle cx="12" cy="5" r="2.4" /><path d="M12 8c-2 0-3 4-3 7l1.5 4M12 8c2 0 3 4 3 7l-1.5 4" stroke="#06140d" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></Circle>
                  <span className="h-[2px] flex-1 rounded-full" style={{ background: ACCENT, opacity: 0.5 }} />
                  <span className="text-right leading-tight">
                    <span className="block text-[13px] font-bold text-white">{VERDICT.durationMin}</span>
                    <span className="block text-[10px] text-white/45">{VERDICT.distanceKm}</span>
                  </span>
                  <Circle><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#06140d" strokeWidth="3.5"><path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg></Circle>
                </div>
              </div>
            )}

            {/* ── Carte d'offre Uber (sonne en phase ring) ── */}
            <div className={`absolute inset-x-2 bottom-2 rounded-[1.3rem] border border-[#3b6cf6]/40 bg-white p-3.5 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.25)] ${phase === 'ring' ? 'showcase-ring' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-lg bg-black px-2.5 py-1 text-[12px] font-semibold text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="7" r="3.2" /><path d="M5 20c0-3.3 3-5 7-5s7 1.7 7 5" /></svg>
                  {OFFER.category}
                </span>
                <span className="rounded-lg bg-[#e9efff] px-2.5 py-1 text-[12px] font-semibold text-[#3b6cf6]">Exclusivité</span>
                <span className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg bg-[#f1f2f4] text-[#6b7178]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="font-display text-[1.9rem] font-extrabold leading-none text-[#0b0d0c]">{OFFER.fare}</span>
                <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-[#0b0d0c] text-[8px] text-white">⚡</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-md bg-[#f1f2f4] px-2 py-1 text-[12px] font-semibold text-[#0b0d0c]">★ {OFFER.rating}</span>
                <span className="rounded-md bg-[#f1f2f4] px-2 py-1 text-[12px] font-medium text-[#6b7178]">Montant net de frais</span>
              </div>
              <div className="mt-2.5 border-t border-[#eceef0] pt-2.5">
                <Leg dot="o" head={OFFER.pickup.eta} sub={OFFER.pickup.addr} />
                <Leg dot="sq" head={OFFER.dest.course} sub={OFFER.dest.addr} last />
              </div>
              <button className="mt-2.5 w-full rounded-xl bg-[#3b6cf6] py-2.5 text-[14px] font-semibold text-white/90">Accepter</button>
            </div>

            {/* ── Balayage OCR (phase scan) ── */}
            {phase === 'scan' && (
              <div className="pointer-events-none absolute inset-0 z-20">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(0,230,118,0.12),transparent_60%)]" />
                <div className="scan-line absolute inset-x-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, boxShadow: `0 0 16px 2px ${ACCENT}` }} />
              </div>
            )}

            {/* ── Bouton Strive (FAB) ── */}
            <button
              onClick={phase === 'done' ? replay : scan}
              aria-label={phase === 'done' ? 'Rejouer' : 'Scanner avec Strive'}
              className={`absolute bottom-[42%] right-3 z-30 flex h-14 w-14 items-center justify-center rounded-full text-[#05140c] transition-transform active:scale-95 ${phase === 'ring' ? 'animate-ring' : ''}`}
              style={{ background: ACCENT, boxShadow: `0 10px 30px -6px ${ACCENT}aa` }}
            >
              {phase === 'scan' ? (
                <svg className="scan-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#05140c" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.2-8.6" strokeLinecap="round" /></svg>
              ) : phase === 'done' ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#05140c" strokeWidth="2.5"><path d="M3 12a9 9 0 109-9" strokeLinecap="round" /><path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <span className="font-display text-2xl font-extrabold">S</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Légende d'état + rejouer ── */}
      <div className="mt-7 flex h-6 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span className={`live-dot ${phase === 'scan' ? '' : 'opacity-40'}`} style={phase === 'done' ? { background: ACCENT } : undefined} />
        <span className="text-muted">{caption}</span>
        {phase === 'done' && (
          <button onClick={replay} className="ml-1 text-signal underline-offset-4 hover:underline">Rejouer</button>
        )}
      </div>
    </div>
  );
}

function Circle({ children }: { children: React.ReactNode }) {
  return <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full" style={{ background: ACCENT }}>{children}</span>;
}

function Leg({ dot, head, sub, last }: { dot: 'o' | 'sq'; head: string; sub: string; last?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center pt-1">
        <span className={`h-2.5 w-2.5 border-2 border-[#0b0d0c] ${dot === 'o' ? 'rounded-full' : 'rounded-[3px]'}`} />
        {!last && <span className="my-0.5 h-5 w-[2px] bg-[#d4d7da]" />}
      </div>
      <div className={last ? '' : 'pb-1.5'}>
        <p className="text-[12.5px] font-semibold leading-tight text-[#0b0d0c]">{head}</p>
        <p className="text-[11px] leading-snug text-[#6b7178]">{sub}</p>
      </div>
    </div>
  );
}

function Map() {
  return (
    <svg viewBox="0 0 340 720" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="340" height="720" fill="#dfe5ea" />
      <path d="M-10 120 Q60 90 120 140 T260 130 360 180 360 260 200 240 60 280 -10 250Z" fill="#cfe3d2" opacity="0.7" />
      <circle cx="40" cy="520" r="70" fill="#cfe3d2" opacity="0.6" />
      <path d="M-10 470 C90 440 160 520 250 480 340 450 360 470 360 470" stroke="#bcd4ea" strokeWidth="22" fill="none" opacity="0.8" />
      {[160, 300, 430, 560].map((y) => (
        <path key={y} d={`M-10 ${y} C100 ${y - 30} 220 ${y + 30} 360 ${y - 10}`} stroke="#ffffff" strokeWidth="6" fill="none" opacity="0.85" />
      ))}
      {[70, 180, 270].map((x) => (
        <path key={x} d={`M${x} -10 C${x + 20} 200 ${x - 20} 480 ${x + 10} 730`} stroke="#ffffff" strokeWidth="5" fill="none" opacity="0.6" />
      ))}
      <path d="M70 250 C110 300 150 300 175 360 C205 430 250 470 285 540" stroke="#9aa1a8" strokeWidth="9" fill="none" strokeLinecap="round" />
      <circle cx="70" cy="250" r="13" fill="#0b0d0c" /><circle cx="70" cy="250" r="4.5" fill="#fff" />
      <circle cx="285" cy="525" r="13" fill="#3b6cf6" /><circle cx="285" cy="521" r="3.2" fill="#fff" />
      <path d="M285 524c-3 0-4.5 4-4.5 7h9c0-3-1.5-7-4.5-7Z" fill="#fff" />
      <circle cx="300" cy="552" r="16" fill="#fff" stroke="#0b0d0c" strokeWidth="2" />
      <path d="M300 544l6 12-6-3-6 3z" fill="#0b0d0c" />
    </svg>
  );
}
