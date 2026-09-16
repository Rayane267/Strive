'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { TIER, ago, dur, type Live } from './types';
import { Card, OnlineDot, Pill } from './ui';

/** Rythme du rafraîchissement. 30 s : assez court pour que « en ligne
 *  maintenant » veuille dire quelque chose, assez long pour que la console
 *  ouverte toute la journée ne pilonne pas la base. */
const REFRESH_MS = 30_000;

export default function LivePanel() {
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_live');
    if (error) setErr(error.message);
    else { setErr(''); setLive(data as Live); }
  }, []);

  useEffect(() => {
    load();

    // L'onglet caché ne rafraîchit pas : une console laissée ouverte dans un
    // onglet de fond interrogeait la base 2 880 fois par jour pour personne.
    const start = () => {
      if (timer.current) return;
      timer.current = setInterval(load, REFRESH_MS);
    };
    const stop = () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { load(); start(); } else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [load]);

  if (err) {
    return (
      <Card title="En ligne maintenant">
        <p role="alert" className="text-sm text-[#FF5A4D]">{err}</p>
      </Card>
    );
  }

  const c = live?.counts;
  const drivers = live?.drivers ?? [];
  const live_count = c ? c.sessions_open - c.stale : 0;

  return (
    <Card
      title="En ligne maintenant"
      subtitle="Session de conduite ouverte — rafraîchi toutes les 30 secondes"
      aside={
        <div className="flex items-center gap-2">
          <OnlineDot />
          <span className="text-2xl font-bold tabular-nums text-white">{live_count}</span>
          <span className="text-xs text-white/45">
            {live_count > 1 ? 'chauffeurs' : 'chauffeur'}
          </span>
        </div>
      }
    >
      {/* Deux mesures divergentes valent mieux qu'une moyenne qui les cache :
          le drapeau `is_online` reste levé quand l'app est tuée, la session
          ouverte aussi. L'écart est un symptôme, pas du bruit. */}
      {c && (c.stale > 0 || c.incoherent > 0) && (
        <p className="-mt-2 mb-4 rounded-lg border border-[#FFC24B]/25 bg-[#FFC24B]/10 px-3 py-2 text-xs text-[#FFC24B]">
          {c.stale > 0 && (
            <>
              {c.stale} session{c.stale > 1 ? 's' : ''} ouverte{c.stale > 1 ? 's' : ''} depuis
              plus de 16 h — l&apos;app a été tuée sans la refermer, ces chauffeurs ne roulent
              probablement pas.
            </>
          )}
          {c.stale > 0 && c.incoherent > 0 && ' '}
          {c.incoherent > 0 && (
            <>
              {c.incoherent} compte{c.incoherent > 1 ? 's' : ''} marqué{c.incoherent > 1 ? 's' : ''}
              {' '}en ligne sans session ouverte.
            </>
          )}
        </p>
      )}

      {drivers.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">
          {live ? 'Personne en ligne.' : 'Chargement…'}
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {drivers.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <OnlineDot stale={d.stale} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white">
                  {d.name ?? d.email ?? d.id.slice(0, 8)}
                </span>
                {d.name && d.email && (
                  <span className="block truncate text-xs text-white/40">{d.email}</span>
                )}
              </span>
              <Pill label={TIER[d.tier].label} color={TIER[d.tier].color} />
              <span className="tabular-nums text-xs text-white/60" title={new Date(d.since).toLocaleString('fr-FR')}>
                {d.stale ? 'ouverte' : 'en ligne'} depuis {dur(d.minutes)}
              </span>
              <span className="tabular-nums text-xs text-white/45">
                {d.scans_today} scan{d.scans_today > 1 ? 's' : ''} · {d.rides_today} course
                {d.rides_today > 1 ? 's' : ''} aujourd&apos;hui
              </span>
              <span className="tabular-nums text-xs text-white/30">
                dernière course {ago(d.last_ride_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
