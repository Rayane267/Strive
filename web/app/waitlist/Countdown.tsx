'use client';

import { useEffect, useState } from 'react';

const UNITS: { key: 'days' | 'hours' | 'minutes' | 'seconds'; label: string }[] = [
  { key: 'days', label: 'Jours' },
  { key: 'hours', label: 'Heures' },
  { key: 'minutes', label: 'Min' },
  { key: 'seconds', label: 'Sec' },
];

function split(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(t / 86400),
    hours: Math.floor((t % 86400) / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
  };
}

export default function Countdown({ target }: { target: string }) {
  // Rendu serveur figé (évite un mismatch d'hydratation) : le vrai décompte ne
  // démarre qu'après le montage côté client.
  const [left, setLeft] = useState<ReturnType<typeof split> | null>(null);

  useEffect(() => {
    const end = new Date(target).getTime();
    if (Number.isNaN(end)) return;
    const tick = () => setLeft(split(end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <div className="flex items-start justify-center gap-2 sm:gap-4" aria-live="off">
      {UNITS.map((u, i) => (
        <div key={u.key} className="flex items-start">
          <div className="w-[4.2rem] text-center sm:w-24">
            <div className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-fg sm:text-6xl">
              {left ? String(left[u.key]).padStart(2, '0') : '--'}
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-faint sm:text-[11px]">
              {u.label}
            </div>
          </div>
          {i < UNITS.length - 1 && (
            <span className="mt-1 font-display text-3xl font-light text-line sm:mt-0 sm:text-5xl">:</span>
          )}
        </div>
      ))}
    </div>
  );
}
