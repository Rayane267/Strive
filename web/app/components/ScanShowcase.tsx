'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

/**
 * Vitrine produit scénarisée et interactive :
 *   1. ring  — une offre arrive (la carte « sonne »), le bouton Strive pulse
 *   2. scan  — l'utilisateur appuie → balayage OCR (~1,4 s)
 *   3. done  — la bulle de verdict tombe
 * À chaque cycle, un des 3 scénarios (rentable / limite / piège) est tiré au
 * hasard. Auto-joue une fois si on n'interagit pas.
 */

type Phase = 'ring' | 'scan' | 'done';
type Kind = 'go' | 'mid' | 'skip';

type Scenario = {
  kind: Kind;
  accent: string;
  caption: string;
  why: { head: string; body: string };
  bubble: { kmRate: string; hourly: string; net: string; durationMin: string; distanceKm: string };
  offer: {
    category: string;
    fare: string;
    rating: string;
    pickup: { eta: string; addr: string };
    dest: { course: string; addr: string };
  };
};

// Chiffres cohérents : total = approche + course ; €/h = tarif / durée ;
// €/km = tarif / distance totale.
const SCENARIOS: Scenario[] = [
  {
    // 17,18 € · 1,2 + 11,8 = 13,0 km · 27 min → 38 €/h · 1,32 €/km
    kind: 'go',
    accent: '#00e676',
    caption: 'Verdict : prends-la.',
    why: { head: 'Une vraie bonne course', body: '13 km, 27 min approche comprise → 38 €/h net. Les deux seuils sont dépassés : fonce.' },
    bubble: { kmRate: '€1.32/km', hourly: '38', net: '€17', durationMin: '27min', distanceKm: '13.0km' },
    offer: {
      category: 'Standard',
      fare: '17,18 €',
      rating: '5,00',
      pickup: { eta: 'à 6 min (1.2 km)', addr: '65 Route de la Libération, 94430 Chennevières-sur-Marne' },
      dest: { course: 'Course de 11.8 km', addr: '16 Rue Charles Pathé, 94300 Vincennes' },
    },
  },
  {
    // 12,40 € · 3,1 + 8,1 = 11,2 km · 31 min → 24 €/h · 1,11 €/km
    kind: 'mid',
    accent: '#ffc24b',
    caption: 'Verdict : à toi de voir.',
    why: { head: 'Correcte, sans plus', body: '24 €/h une fois l\'approche déduite. Ça passe ou ça casse selon ta zone et l\'heure — à toi de juger.' },
    bubble: { kmRate: '€1.11/km', hourly: '24', net: '€12', durationMin: '31min', distanceKm: '11.2km' },
    offer: {
      category: 'Standard',
      fare: '12,40 €',
      rating: '4,91',
      pickup: { eta: 'à 9 min (3.1 km)', addr: '12 Avenue du Général de Gaulle, 94170 Le Perreux-sur-Marne' },
      dest: { course: 'Course de 8.1 km', addr: '5 Rue de Paris, 93100 Montreuil' },
    },
  },
  {
    // 8,90 € · 6,4 + 3,1 = 9,5 km · 38 min → 14 €/h · 0,94 €/km
    kind: 'skip',
    accent: '#ff5a4d',
    caption: 'Verdict : laisse-la.',
    why: { head: 'Le piège classique', body: 'Tarif alléchant… mais 18 min d\'approche pour 3 km de course. Résultat : 14 €/h. Strive te le dit avant que tu acceptes.' },
    bubble: { kmRate: '€0.94/km', hourly: '14', net: '€9', durationMin: '38min', distanceKm: '9.5km' },
    offer: {
      category: 'Standard',
      fare: '8,90 €',
      rating: '4,80',
      pickup: { eta: 'à 18 min (6.4 km)', addr: '8 Avenue de la République, 94000 Créteil' },
      dest: { course: 'Course de 3.1 km', addr: '2 Rue du Pont, 94100 Saint-Maur-des-Fossés' },
    },
  },
];

const randomIdx = (exclude?: number) => {
  let n = Math.floor(Math.random() * SCENARIOS.length);
  if (exclude !== undefined) while (n === exclude) n = Math.floor(Math.random() * SCENARIOS.length);
  return n;
};

export default function ScanShowcase() {
  const [phase, setPhase] = useState<Phase>('ring');
  const [idx, setIdx] = useState(0); // déterministe au SSR ; randomisé au mount
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const s = SCENARIOS[idx];
  const accent = s.accent;
  // Couleur neutre tant que le verdict n'est pas révélé : on ne spoile pas
  // vert/ambre/rouge pendant l'attente et le scan.
  const c = phase === 'done' ? accent : '#d8dee0';

  // Mount : tire un scénario au hasard, puis auto-démo QUAND la démo entre à
  // l'écran (la section est sous la ligne de flottaison).
  useEffect(() => {
    setIdx(randomIdx());
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setPhase('done'); return; }
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          obs.disconnect();
          autoTimer.current = setTimeout(() => setPhase((p) => (p === 'ring' ? 'scan' : p)), 1100);
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => { obs.disconnect(); if (autoTimer.current) clearTimeout(autoTimer.current); };
  }, []);

  // Dès qu'on entre en scan, programmer la chute du verdict
  useEffect(() => {
    if (phase !== 'scan') return;
    const t = setTimeout(() => setPhase('done'), 1450);
    return () => clearTimeout(t);
  }, [phase]);

  const scan = () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    if (phase !== 'scan') setPhase('scan');
  };
  const replay = () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setIdx((i) => randomIdx(i)); // nouveau scénario, jamais le même deux fois de suite
    setPhase('ring');
  };

  const caption =
    phase === 'ring' ? 'Une course arrive — appuie sur Strive'
    : phase === 'scan' ? 'Analyse de l\'offre…'
    : s.caption;

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-12 lg:flex-row lg:items-center lg:gap-16">
      <div className="flex flex-col items-center">
      <div className="relative w-[300px] sm:w-[336px]">
        {/* Boutons latéraux (titane) */}
        <span className="absolute -left-[3px] top-[120px] h-7 w-[3px] rounded-l" style={{ background: 'linear-gradient(180deg,#42473f,#23271f)' }} />
        <span className="absolute -left-[3px] top-[168px] h-12 w-[3px] rounded-l" style={{ background: 'linear-gradient(180deg,#42473f,#23271f)' }} />
        <span className="absolute -left-[3px] top-[228px] h-12 w-[3px] rounded-l" style={{ background: 'linear-gradient(180deg,#42473f,#23271f)' }} />
        <span className="absolute -right-[3px] top-[196px] h-16 w-[3px] rounded-r" style={{ background: 'linear-gradient(180deg,#42473f,#23271f)' }} />

        {/* Châssis titane */}
        <div className="relative rounded-[3.2rem] p-[11px] shadow-[0_50px_120px_-30px_rgba(0,0,0,0.9)]" style={{ background: 'linear-gradient(150deg,#5b6158,#2b2f29 28%,#3c413a 60%,#23271f)' }}>
          <div className="overflow-hidden rounded-[2.7rem] bg-black p-[2px]">
            <div className="relative aspect-[9/19.5] overflow-hidden rounded-[2.55rem] bg-[#e9eef3]">
              <Map />

              {/* Barre d'état iOS */}
              <div className="absolute inset-x-0 top-0 z-40 flex h-12 items-center justify-between px-7 pt-1">
                <span className="font-display text-[14px] font-semibold text-[#0b0d0c]">9:41</span>
                <span className="flex items-center gap-1.5 text-[#0b0d0c]">
                  <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
                  <svg width="16" height="11" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.5c2.6 0 5 1 6.8 2.7l-1.5 1.6A7.4 7.4 0 008 4.7c-2 0-3.9.8-5.3 2.1L1.2 5.2A9.6 9.6 0 018 2.5z" opacity="0.95" /><path d="M8 6.6c1.4 0 2.7.5 3.7 1.5l-1.6 1.6A2.9 2.9 0 008 8.8c-.8 0-1.5.3-2.1.9L4.3 8.1A5.1 5.1 0 018 6.6z" /><circle cx="8" cy="11" r="1.3" /></svg>
                  <span className="flex items-center"><span className="relative h-[11px] w-[22px] rounded-[3px] border border-[#0b0d0c]/40"><span className="absolute inset-[1.5px] right-[5px] rounded-[1px] bg-[#0b0d0c]" /></span><span className="ml-[1px] h-[4px] w-[1.5px] rounded-r bg-[#0b0d0c]/40" /></span>
                </span>
              </div>

              {/* Dynamic Island */}
              <div className="absolute left-1/2 top-2 z-50 h-[26px] w-[88px] -translate-x-1/2 rounded-full bg-black" />

              {/* ── Bulle de verdict (phase done) ── */}
              {phase === 'done' && (
                <div key={idx} className="showcase-pop absolute inset-x-3 top-[3.4rem] rounded-[1.4rem] bg-[#0b0d0c] p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-white/90">VTC · Course</span>
                    <span className="flex items-center gap-1 text-[13px] font-bold text-white">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="3"><path d="M7 17L17 7M17 7H9M17 7v8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {s.bubble.kmRate}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-center gap-2">
                    <span className="font-display text-[2rem] font-extrabold leading-none text-white">€{s.bubble.hourly}</span>
                    <span className="text-sm text-white/50">/h</span>
                    <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: accent + '28', color: accent, border: `1px solid ${accent}55` }}>{s.bubble.net}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2.5">
                    <Circle accent={accent}><svg width="13" height="13" viewBox="0 0 24 24" fill="#06140d"><path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-6z" /></svg></Circle>
                    <span className="h-[2px] flex-1 rounded-full" style={{ background: accent, opacity: 0.5 }} />
                    <Circle accent={accent}><svg width="12" height="12" viewBox="0 0 24 24" fill="#06140d"><circle cx="12" cy="5" r="2.4" /><path d="M12 8c-2 0-3 4-3 7l1.5 4M12 8c2 0 3 4 3 7l-1.5 4" stroke="#06140d" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></Circle>
                    <span className="h-[2px] flex-1 rounded-full" style={{ background: accent, opacity: 0.5 }} />
                    <span className="text-right leading-tight">
                      <span className="block text-[13px] font-bold text-white">{s.bubble.durationMin}</span>
                      <span className="block text-[10px] text-white/45">{s.bubble.distanceKm}</span>
                    </span>
                    <Circle accent={accent}><VerdictIcon kind={s.kind} /></Circle>
                  </div>
                </div>
              )}

              {/* ── Carte d'offre (sonne en phase ring) ── */}
              <div className={`absolute inset-x-2 bottom-2 rounded-[1.3rem] border border-[#3b6cf6]/40 bg-white p-3.5 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.25)] ${phase === 'ring' ? 'showcase-ring' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-lg bg-black px-2.5 py-1 text-[12px] font-semibold text-white">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="7" r="3.2" /><path d="M5 20c0-3.3 3-5 7-5s7 1.7 7 5" /></svg>
                    {s.offer.category}
                  </span>
                  <span className="rounded-lg bg-[#e9efff] px-2.5 py-1 text-[12px] font-semibold text-[#3b6cf6]">Exclusivité</span>
                  <span className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg bg-[#f1f2f4] text-[#6b7178]">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="font-display text-[1.9rem] font-extrabold leading-none text-[#0b0d0c]">{s.offer.fare}</span>
                  <svg width="17" height="19" viewBox="0 0 17 19" className="text-[#9aa1a8]" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8.5 1l6.5 3.75v7.5L8.5 16 2 12.25v-7.5z" /><path d="M9 6l-2.5 3.4h2L8 13l2.6-3.6h-2z" fill="currentColor" stroke="none" /></svg>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-md bg-[#f1f2f4] px-2 py-1 text-[12px] font-semibold text-[#0b0d0c]">★ {s.offer.rating}</span>
                  <span className="rounded-md bg-[#f1f2f4] px-2 py-1 text-[12px] font-medium text-[#6b7178]">Montant net de frais</span>
                </div>
                <div className="mt-2.5 border-t border-[#eceef0] pt-2.5">
                  <Leg dot="o" head={s.offer.pickup.eta} sub={s.offer.pickup.addr} />
                  <Leg dot="sq" head={s.offer.dest.course} sub={s.offer.dest.addr} last />
                </div>
                <button className="mt-2.5 w-full rounded-xl bg-[#3b6cf6] py-2.5 text-[14px] font-semibold text-white/90">Accepter</button>
              </div>

              {/* ── Balayage OCR (phase scan) ── */}
              {phase === 'scan' && (
                <div className="pointer-events-none absolute inset-0 z-20">
                  <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${c}33, transparent 60%)` }} />
                  <div className="scan-line absolute inset-x-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${c}, transparent)`, boxShadow: `0 0 16px 2px ${c}` }} />
                </div>
              )}

              {/* ── Bouton Strive (FAB) ── */}
              <button
                onClick={phase === 'done' ? replay : scan}
                aria-label={phase === 'done' ? 'Rejouer' : 'Scanner avec Strive'}
                className={`absolute bottom-[42%] right-3 z-30 flex h-14 w-14 items-center justify-center rounded-full transition-transform active:scale-95 ${phase === 'ring' ? 'animate-ring' : ''}`}
                style={{ background: '#0b1310', border: `1.5px solid ${c}`, boxShadow: `0 10px 30px -6px ${c}aa` }}
              >
                {phase === 'scan' ? (
                  <svg className="scan-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.2-8.6" strokeLinecap="round" /></svg>
                ) : phase === 'done' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5"><path d="M3 12a9 9 0 109-9" strokeLinecap="round" /><path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <Image src="/strive-logo.png" alt="Strive" width={34} height={34} className="h-9 w-9 rounded-[10px]" />
                )}
              </button>

              {/* Barre d'accueil iOS */}
              <span className="absolute bottom-1.5 left-1/2 z-40 h-1 w-28 -translate-x-1/2 rounded-full bg-[#0b0d0c]/35" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Légende d'état + rejouer ── */}
      <div className="mt-7 flex h-6 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: c, opacity: phase === 'ring' ? 0.4 : 1 }}
        />
        <span className="text-muted">{caption}</span>
        {phase === 'done' && (
          <button onClick={replay} className="ml-1 text-signal underline-offset-4 hover:underline">Rejouer</button>
        )}
      </div>
      </div>

      <ValuePanel s={s} revealed={phase === 'done'} />
    </div>
  );
}

function ValuePanel({ s, revealed }: { s: Scenario; revealed: boolean }) {
  const points = [
    { t: 'Le €/h réel', d: 'Temps d\'approche inclus — pas le tarif brut qui t\'illusionne.' },
    { t: 'Net après carburant', d: 'La conso de ton véhicule déduite, automatiquement.' },
    { t: 'Verdict en 2 secondes', d: 'Avant d\'accepter, sans quitter ton app de course.' },
  ];
  return (
    <div className="max-w-sm text-left lg:max-w-xs">
      <span className="eyebrow">Ce que l&apos;app voit</span>
      <h3 className="mt-4 font-display text-2xl font-bold leading-tight">
        Le tarif ment.<br />Le <span className="text-signal">€/h</span> dit la vérité.
      </h3>

      <ul className="mt-7 space-y-5">
        {points.map((p) => (
          <li key={p.t} className="flex gap-3">
            <span className="mt-1 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-signal/15 text-signal ring-1 ring-signal/25">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{p.t}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{p.d}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* Lecture dynamique du verdict courant */}
      <div
        className="glass mt-8 rounded-2xl p-4 transition-opacity duration-500"
        style={{ opacity: revealed ? 1 : 0.35, borderColor: revealed ? `${s.accent}40` : undefined }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: revealed ? s.accent : '#d8dee0' }} />
          <p className="font-display text-sm font-bold" style={{ color: revealed ? s.accent : 'var(--color-muted)' }}>
            {revealed ? s.why.head : 'Analyse en cours…'}
          </p>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {revealed ? s.why.body : 'Lance le scan : Strive lit l\'offre et explique son verdict.'}
        </p>
      </div>
    </div>
  );
}

function VerdictIcon({ kind }: { kind: Kind }) {
  if (kind === 'go') return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#06140d" strokeWidth="3.5"><path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (kind === 'skip') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#160605" strokeWidth="3.5"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>;
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#160d00" strokeWidth="3.2"><path d="M12 6v8" strokeLinecap="round" /><circle cx="12" cy="18" r="0.6" fill="#160d00" stroke="none" /></svg>;
}

function Circle({ accent, children }: { accent: string; children: React.ReactNode }) {
  return <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full" style={{ background: accent }}>{children}</span>;
}

function Leg({ dot, head, sub, last }: { dot: 'o' | 'sq'; head: string; sub: string; last?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center pt-1">
        <span className={`h-2.5 w-2.5 border-2 border-[#0b0d0c] ${dot === 'o' ? 'rounded-full' : 'rounded-[3px]'}`} />
        {!last && <span className="my-0.5 h-5 w-[2px] bg-[#d4d7da]" />}
      </div>
      <div className={`text-left ${last ? '' : 'pb-1.5'}`}>
        <p className="text-[12.5px] font-semibold leading-tight text-[#0b0d0c]">{head}</p>
        <p className="text-[11px] leading-snug text-[#6b7178]">{sub}</p>
      </div>
    </div>
  );
}

function Map() {
  return (
    <svg viewBox="0 0 340 720" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden fontFamily="var(--font-body)">
      <rect width="340" height="720" fill="#e4e8ec" />
      <path d="M-10 110 Q60 80 120 130 T260 120 360 170 360 250 200 230 60 270 -10 240Z" fill="#d2e6d4" opacity="0.8" />
      <circle cx="36" cy="540" r="74" fill="#d2e6d4" opacity="0.7" />
      <rect x="232" y="300" width="86" height="64" rx="10" fill="#d2e6d4" opacity="0.6" />
      <path d="M-10 460 C90 432 160 512 250 472 340 444 360 462 360 462" stroke="#bcd4ea" strokeWidth="20" fill="none" opacity="0.85" />
      <path d="M-10 300 C100 270 220 330 360 300" stroke="#ffffff" strokeWidth="9" fill="none" />
      <path d="M120 -10 C150 200 110 480 150 730" stroke="#ffffff" strokeWidth="9" fill="none" />
      {[150, 210, 380, 600, 660].map((y) => (
        <path key={y} d={`M-10 ${y} C110 ${y - 26} 230 ${y + 26} 360 ${y - 8}`} stroke="#ffffff" strokeWidth="4.5" fill="none" opacity="0.9" />
      ))}
      {[60, 250, 300].map((x) => (
        <path key={x} d={`M${x} -10 C${x + 18} 220 ${x - 18} 480 ${x + 8} 730`} stroke="#ffffff" strokeWidth="4" fill="none" opacity="0.7" />
      ))}
      <path d="M70 250 C110 300 150 300 175 360 C205 430 250 470 285 540" stroke="#8b929a" strokeWidth="9" fill="none" strokeLinecap="round" />
      <g fill="#6b7480" fontWeight="600">
        <text x="150" y="196" fontSize="13">Nogent-sur-Marne</text>
        <text x="120" y="430" fontSize="13">Champigny-sur-Marne</text>
        <text x="20" y="612" fontSize="13">Créteil</text>
        <text x="300" y="500" fontSize="13" textAnchor="end">Vincennes</text>
      </g>
      <g fill="#9aa1a8" fontWeight="500" fontSize="9">
        <text x="30" y="292" transform="rotate(-12 30 292)">Bd. de Strasbourg</text>
        <text x="160" y="350" transform="rotate(64 160 350)">Av. Roger Salengro</text>
        <text x="210" y="660">Rue Charles Pathé</text>
      </g>
      <g><rect x="206" y="612" width="30" height="17" rx="4" fill="#f4d35e" /><text x="221" y="625" fontSize="11" fontWeight="700" fill="#3a3a2a" textAnchor="middle">D4</text></g>
      <circle cx="70" cy="250" r="13" fill="#0b0d0c" /><circle cx="70" cy="250" r="4.5" fill="#fff" />
      <circle cx="285" cy="525" r="13" fill="#3b6cf6" /><circle cx="285" cy="521" r="3.2" fill="#fff" />
      <path d="M285 524c-3 0-4.5 4-4.5 7h9c0-3-1.5-7-4.5-7Z" fill="#fff" />
      <circle cx="300" cy="552" r="16" fill="#fff" stroke="#0b0d0c" strokeWidth="2" />
      <path d="M300 544l6 12-6-3-6 3z" fill="#0b0d0c" />
    </svg>
  );
}
