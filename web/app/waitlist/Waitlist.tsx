'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const UNITS: { key: 'days' | 'hours' | 'minutes' | 'seconds'; label: string }[] = [
  { key: 'days', label: 'Jours' },
  { key: 'hours', label: 'Heures' },
  { key: 'minutes', label: 'Min' },
  { key: 'seconds', label: 'Sec' },
];

const ERRORS: Record<string, string> = {
  invalid_email: 'Cette adresse e-mail ne semble pas valide.',
  disposable_email_not_allowed: 'Les adresses jetables ne sont pas acceptées.',
};

function split(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(t / 86400),
    hours: Math.floor((t % 86400) / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
  };
}

export default function Waitlist({ target }: { target: string }) {
  // Compte à rebours : figé au rendu serveur (pas de mismatch d'hydratation),
  // il démarre au montage.
  const [left, setLeft] = useState<ReturnType<typeof split> | null>(null);
  useEffect(() => {
    const end = new Date(target).getTime();
    if (Number.isNaN(end)) return;
    const tick = () => setLeft(split(end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    // Honeypot : un bot remplit le champ caché → on simule un succès.
    if (honeypot.current?.value) {
      setDone(true);
      return;
    }
    setStatus('');
    setLoading(true);

    const params = new URLSearchParams(window.location.search);
    const { error } = await supabase.rpc('join_waitlist', {
      p_email: email,
      p_source: params.get('utm_source') ?? params.get('src') ?? 'landing',
      p_locale: navigator.language,
      p_referrer: document.referrer || null,
    });
    setLoading(false);

    if (error) {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      setStatus(key ? ERRORS[key] : 'Inscription impossible pour le moment. Réessaie dans un instant.');
      return;
    }
    setDone(true);
  }

  return (
    <main className="wl-hero">
      <div className={`wl-badge-wrap${done ? ' is-done' : ''}`} id="wl-badge-wrap">
        <span className="wl-badge-glow" aria-hidden="true" />
        <div className="wl-badge">
          <span className="wl-badge-spin" aria-hidden="true" />
          <span className="wl-badge-label" id="wl-badge-label" aria-live="polite">
            <span className="wl-badge-text is-wait">Liste d&apos;attente</span>
            <span className="wl-badge-text is-ok" aria-hidden="true">Inscrit ✅</span>
          </span>
        </div>
      </div>

      <h1 className="wl-title">Coming soon!</h1>

      <div className="wl-countdown" id="wl-countdown" aria-live="polite">
        {UNITS.map((u, i) => (
          <div key={u.key} style={{ display: 'contents' }}>
            <div className="wl-cd-cell">
              <span className="wl-cd-num">{left ? String(left[u.key]).padStart(2, '0') : '00'}</span>
              <span className="wl-cd-label">{u.label}</span>
            </div>
            {i < UNITS.length - 1 && (
              <span className="wl-cd-sep" aria-hidden="true">:</span>
            )}
          </div>
        ))}
      </div>

      <div className="wl-card-shell" id="wl-card-shell">
        <span className="wl-card-spin" aria-hidden="true" />
        <span className="wl-card-spin-blur" aria-hidden="true" />
        <section className="wl-card" id="waitlist" aria-labelledby="wl-card-title">
          <span className="wl-card-edge" aria-hidden="true" />
          <span className="wl-card-glow" aria-hidden="true" />

          {!done ? (
            <div className="wl-card-live" id="wl-card-live">
              <h2 id="wl-card-title">Rejoins la liste d&apos;attente !</h2>
              <p className="wl-card-copy">
                Sois prévenu dès que Strive ouvre. Scan des courses, €/h réel et trafic temps réel —
                en avant-première.
              </p>
              <form id="waitlist-form" className="wl-form" onSubmit={submit} noValidate>
                <label className="visually-hidden" htmlFor="email">E-mail</label>
                <input
                  className="visually-hidden"
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  ref={honeypot}
                />
                <div className="wl-email-wrap" id="wl-email-wrap">
                  <span className="wl-email-spin" aria-hidden="true" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="Ton e-mail"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button
                  id="waitlist-submit"
                  className={`wl-submit${loading ? ' is-loading' : ''}`}
                  type="submit"
                  disabled={loading}
                >
                  <span className="wl-submit-label">Rejoindre</span>
                  <span className="wl-submit-loader" aria-hidden="true" />
                </button>
                <p id="form-status" className="wl-status" role="status" aria-live="polite">
                  {status}
                </p>
              </form>
            </div>
          ) : (
            <div className="wl-card-done" id="wl-card-done">
              <div className="wl-check-wrap" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="wl-spark" style={{ '--i': i } as React.CSSProperties} />
                ))}
                <div className="wl-check">
                  <svg viewBox="0 0 52 52" fill="none">
                    <path
                      className="wl-check-mark"
                      d="M15 26.8l8 8.2L37.5 19"
                      strokeWidth="3.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <p className="wl-congrats">Félicitations</p>
              <h2 id="wl-done-title">Tu es sur la liste</h2>
              <p className="wl-card-copy wl-success-copy">
                On t&apos;écrit dès que Strive ouvre. Vérifie tes e-mails.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
