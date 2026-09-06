'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type State =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'done'; position: number; already: boolean }
  | { s: 'error'; message: string };

const ERRORS: Record<string, string> = {
  invalid_email: 'Cette adresse e-mail ne semble pas valide.',
  disposable_email_not_allowed: 'Les adresses jetables ne sont pas acceptées.',
};

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ s: 'idle' });
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .rpc('waitlist_count')
      .then(({ data, error }) => {
        if (!error && typeof data === 'number') setTotal(data);
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.s === 'loading') return;
    setState({ s: 'loading' });

    const params = new URLSearchParams(window.location.search);
    const { data, error } = await supabase.rpc('join_waitlist', {
      p_email: email,
      p_source: params.get('utm_source') ?? params.get('src') ?? 'landing',
      p_locale: navigator.language,
      p_referrer: document.referrer || null,
    });

    if (error) {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      setState({
        s: 'error',
        message: key ? ERRORS[key] : "Inscription impossible pour le moment. Réessaie dans un instant.",
      });
      return;
    }

    const result = data as { position: number; already_registered: boolean; total: number };
    setTotal(result.total);
    setState({ s: 'done', position: result.position, already: result.already_registered });
  }

  if (state.s === 'done') {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-signal/12 ring-1 ring-signal/25">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-signal">
            <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="mt-6 font-display text-2xl font-bold">
          {state.already ? 'Tu y étais déjà.' : 'Tu es sur la liste.'}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Ta place :{' '}
          <span className="font-mono font-bold text-signal">#{state.position}</span>. On t&apos;écrit dès
          que Strive ouvre — accès prioritaire et essai offert pour les premiers inscrits.
        </p>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
          Pense à vérifier tes spams
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="text-center">
      <h3 className="font-display text-2xl font-bold sm:text-3xl">Rejoins la liste d&apos;attente</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">
        Sois prévenu dès l&apos;ouverture. Scan des offres, €/h réel et trafic temps réel — en
        avant-première.
      </p>

      <div className="mt-7 space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ton@email.com"
          autoComplete="email"
          aria-label="Adresse e-mail"
          className="w-full rounded-2xl border border-line bg-canvas/60 px-5 py-4 text-center text-[15px] text-fg outline-none transition-colors placeholder:text-faint focus:border-signal/50 focus:ring-2 focus:ring-signal/15"
        />
        <button
          type="submit"
          disabled={state.s === 'loading'}
          className="btn btn-signal shimmer w-full rounded-2xl py-4 text-[15px] disabled:opacity-60"
        >
          {state.s === 'loading' ? 'Inscription…' : 'Rejoindre'}
        </button>
      </div>

      {state.s === 'error' && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}

      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
        {total !== null && total > 0 ? `${total} chauffeurs déjà inscrits · ` : ''}Zéro spam
      </p>
    </form>
  );
}
