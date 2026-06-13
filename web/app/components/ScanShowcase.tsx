'use client';

import { useState } from 'react';

/**
 * Vitrine produit interactive : recrée l'écran réel de Strive — la bulle de
 * verdict par-dessus une offre VTC, sur fond de carte. Toggle Rentable / Piège
 * pour démontrer le cœur du produit (vert = prends, rouge = laisse).
 */

type Offer = {
  platform: string;
  category: string;
  kmRate: string;        // €/km affiché en haut de bulle
  hourly: string;        // €/h (gros chiffre)
  net: string;           // pastille net (ex "€17")
  durationMin: string;
  distanceKm: string;
  fare: string;          // tarif sur la carte Uber
  rating: string;
  pickup: { eta: string; addr: string };
  dest: { course: string; addr: string };
  good: boolean;
};

const RENTABLE: Offer = {
  platform: 'Uber',
  category: 'UberX',
  kmRate: '€1.35/km',
  hourly: '38',
  net: '€17',
  durationMin: '27min',
  distanceKm: '12.7km',
  fare: '17,18 €',
  rating: '5,00',
  pickup: { eta: 'à 6 min (1.2 km)', addr: '65 Route de la Libération, 94430 Chennevières-sur-Marne' },
  dest: { course: 'Course de 11.8 km', addr: '16 Rue Charles Pathé, 94300 Vincennes' },
  good: true,
};

const PIEGE: Offer = {
  platform: 'Uber',
  category: 'UberX',
  kmRate: '€0.71/km',
  hourly: '12',
  net: '€6',
  durationMin: '34min',
  distanceKm: '13.9km',
  fare: '9,90 €',
  rating: '4,82',
  pickup: { eta: 'à 15 min (5.4 km)', addr: '8 Avenue de la République, 94000 Créteil' },
  dest: { course: 'Course de 3.1 km', addr: '2 Rue du Général Leclerc, 94100 Saint-Maur' },
  good: false,
};

export default function ScanShowcase() {
  const [good, setGood] = useState(true);
  const o = good ? RENTABLE : PIEGE;
  const accent = good ? '#00e676' : '#ff5a4d';

  return (
    <div className="flex flex-col items-center">
      {/* ── Phone ── */}
      <div className="relative w-[300px] sm:w-[336px]">
        <div className="relative rounded-[3rem] border border-white/12 bg-[#05140c] p-2.5 shadow-[0_50px_120px_-30px_rgba(0,0,0,0.9)]">
          <div className="relative aspect-[9/19] overflow-hidden rounded-[2.4rem] bg-[#e9eef3]">
            {/* Map */}
            <Map accent={accent} />

            {/* ── Bulle Strive (overlay verdict) ── */}
            <div
              key={good ? 'g' : 'b'}
              className="showcase-pop absolute inset-x-3 top-3 rounded-[1.4rem] bg-[#0b0d0c] p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white/90">{o.platform}</span>
                <span className="flex items-center gap-1 text-[13px] font-bold text-white">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="3">
                    <path d="M7 17L17 7M17 7H9M17 7v8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {o.kmRate}
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-center gap-2">
                <span className="font-display text-[2rem] font-extrabold leading-none text-white">€{o.hourly}</span>
                <span className="text-sm text-white/50">/h</span>
                <span
                  className="rounded-full px-2.5 py-1 text-[12px] font-bold"
                  style={{ background: good ? 'rgba(0,230,118,0.16)' : 'rgba(255,90,77,0.16)', color: accent, border: `1px solid ${accent}55` }}
                >
                  {o.net}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2.5">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full" style={{ background: accent }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#06140d"><path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-6z" /></svg>
                </span>
                <span className="h-[2px] flex-1 rounded-full" style={{ background: accent, opacity: 0.5 }} />
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full" style={{ background: accent }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#06140d"><circle cx="12" cy="5" r="2.4" /><path d="M12 8c-2 0-3 4-3 7l1.5 4M12 8c2 0 3 4 3 7l-1.5 4" stroke="#06140d" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
                </span>
                <span className="h-[2px] flex-1 rounded-full" style={{ background: accent, opacity: 0.5 }} />
                <span className="text-right leading-tight">
                  <span className="block text-[13px] font-bold text-white">{o.durationMin}</span>
                  <span className="block text-[10px] text-white/45">{o.distanceKm}</span>
                </span>
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full" style={{ background: accent }}>
                  {good ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#06140d" strokeWidth="3.5"><path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#160605" strokeWidth="3.5"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                  )}
                </span>
              </div>
            </div>

            {/* ── Carte d'offre Uber ── */}
            <div className="absolute inset-x-2 bottom-2 rounded-[1.3rem] border border-[#3b6cf6]/40 bg-white p-3.5 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.25)]">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-lg bg-black px-2.5 py-1 text-[12px] font-semibold text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="7" r="3.2" /><path d="M5 20c0-3.3 3-5 7-5s7 1.7 7 5" /></svg>
                  {o.category}
                </span>
                <span className="rounded-lg bg-[#e9efff] px-2.5 py-1 text-[12px] font-semibold text-[#3b6cf6]">Exclusivité</span>
                <span className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg bg-[#f1f2f4] text-[#6b7178]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                </span>
              </div>

              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="font-display text-[1.9rem] font-extrabold leading-none text-[#0b0d0c]">{o.fare}</span>
                <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-[#0b0d0c] text-[8px] text-white">⚡</span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <span className="flex items-center gap-1 rounded-md bg-[#f1f2f4] px-2 py-1 text-[12px] font-semibold text-[#0b0d0c]">★ {o.rating}</span>
                <span className="rounded-md bg-[#f1f2f4] px-2 py-1 text-[12px] font-medium text-[#6b7178]">Montant net de frais</span>
              </div>

              <div className="mt-2.5 border-t border-[#eceef0] pt-2.5">
                <Leg dot="o" head={o.pickup.eta} sub={o.pickup.addr} />
                <Leg dot="sq" head={o.dest.course} sub={o.dest.addr} last />
              </div>

              <button className="mt-2.5 w-full rounded-xl bg-[#3b6cf6] py-2.5 text-[14px] font-semibold text-white/90">
                Accepter
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contrôle interactif ── */}
      <div className="glass mt-7 inline-flex items-center gap-1 rounded-full p-1">
        <Toggle active={good} onClick={() => setGood(true)} accent="#00e676">Rentable</Toggle>
        <Toggle active={!good} onClick={() => setGood(false)} accent="#ff5a4d">Piège</Toggle>
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        Essaie — le verdict change en direct
      </p>
    </div>
  );
}

function Toggle({ active, onClick, accent, children }: { active: boolean; onClick: () => void; accent: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-5 py-2 text-[13px] font-semibold transition-all"
      style={
        active
          ? { background: accent, color: accent === '#00e676' ? '#05140c' : '#160605' }
          : { color: 'var(--color-muted)' }
      }
    >
      {children}
    </button>
  );
}

function Leg({ dot, head, sub, last }: { dot: 'o' | 'sq'; head: string; sub: string; last?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center pt-1">
        {dot === 'o' ? (
          <span className="h-2.5 w-2.5 rounded-full border-2 border-[#0b0d0c]" />
        ) : (
          <span className="h-2.5 w-2.5 rounded-[3px] border-2 border-[#0b0d0c]" />
        )}
        {!last && <span className="my-0.5 h-5 w-[2px] bg-[#d4d7da]" />}
      </div>
      <div className={last ? '' : 'pb-1.5'}>
        <p className="text-[12.5px] font-semibold leading-tight text-[#0b0d0c]">{head}</p>
        <p className="text-[11px] leading-snug text-[#6b7178]">{sub}</p>
      </div>
    </div>
  );
}

function Map({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 340 720" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="340" height="720" fill="#dfe5ea" />
      {/* parcs */}
      <path d="M-10 120 Q60 90 120 140 T260 130 360 180 360 260 200 240 60 280 -10 250Z" fill="#cfe3d2" opacity="0.7" />
      <circle cx="40" cy="520" r="70" fill="#cfe3d2" opacity="0.6" />
      {/* rivière */}
      <path d="M-10 470 C90 440 160 520 250 480 340 450 360 470 360 470" stroke="#bcd4ea" strokeWidth="22" fill="none" opacity="0.8" />
      {/* routes secondaires */}
      {[160, 300, 430, 560].map((y) => (
        <path key={y} d={`M-10 ${y} C100 ${y - 30} 220 ${y + 30} 360 ${y - 10}`} stroke="#ffffff" strokeWidth="6" fill="none" opacity="0.85" />
      ))}
      {[70, 180, 270].map((x) => (
        <path key={x} d={`M${x} -10 C${x + 20} 200 ${x - 20} 480 ${x + 10} 730`} stroke="#ffffff" strokeWidth="5" fill="none" opacity="0.6" />
      ))}
      {/* itinéraire */}
      <path d="M70 250 C110 300 150 300 175 360 C205 430 250 470 285 540" stroke="#9aa1a8" strokeWidth="9" fill="none" strokeLinecap="round" />
      {/* pin départ */}
      <circle cx="70" cy="250" r="13" fill="#0b0d0c" />
      <circle cx="70" cy="250" r="4.5" fill="#fff" />
      {/* passager */}
      <circle cx="285" cy="525" r="13" fill="#3b6cf6" />
      <circle cx="285" cy="521" r="3.2" fill="#fff" />
      <path d="M285 524c-3 0-4.5 4-4.5 7h9c0-3-1.5-7-4.5-7Z" fill="#fff" />
      {/* position chauffeur */}
      <circle cx="300" cy="552" r="16" fill="#fff" stroke="#0b0d0c" strokeWidth="2" />
      <path d="M300 544l6 12-6-3-6 3z" fill="#0b0d0c" />
    </svg>
  );
}
