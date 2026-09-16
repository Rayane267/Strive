'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';
import TicketsView from './TicketsView';
import AnalyticsView from './AnalyticsView';

type Tab = 'tickets' | 'analytics';

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    supabase.from('profiles').select('is_admin').eq('id', session.user.id).single()
      .then(({ data }) => { if (!cancelled) setIsAdmin(!!data?.is_admin); });
    return () => { cancelled = true; };
  }, [session]);

  // Dérivé plutôt que remis à zéro dans un effet : sans session, il n'y a pas
  // de verdict de droits à afficher.
  const adminState = session ? isAdmin : null;

  if (checking) return <Shell><p className="text-white/60">Chargement…</p></Shell>;
  if (!session) return <Login />;
  if (adminState === null) return <Shell><p className="text-white/60">Vérification des droits…</p></Shell>;
  if (!adminState) return (
    <Shell>
      <p className="text-white/80">Accès refusé — ce compte n&apos;est pas administrateur.</p>
      <button onClick={() => supabase.auth.signOut()} className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15">Se déconnecter</button>
    </Shell>
  );
  return <Console email={session.user.email ?? ''} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#080A09] p-6 text-center">
      {children}
    </main>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Confort : "admin" est un alias du vrai compte Supabase admin@striveapp.fr.
  // Le mot de passe n'est JAMAIS dans le code — il vit haché dans Supabase.
  const ADMIN_ALIAS_DOMAIN = 'striveapp.fr';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const loginEmail = email.includes('@') ? email.trim() : `${email.trim()}@${ADMIN_ALIAS_DOMAIN}`;
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: pw });
    if (error) setErr('Identifiants invalides.');
    setBusy(false);
  };

  return (
    <Shell>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0F1311] p-8 text-left">
        <h1 className="text-xl font-bold text-white">Strive — Admin support</h1>
        <p className="mt-1 text-sm text-white/60">Connecte-toi avec ton compte administrateur.</p>
        <label htmlFor="admin-id" className="mt-6 block text-xs font-semibold uppercase tracking-wide text-white/60">Identifiant</label>
        <input id="admin-id" type="text" value={email} onChange={e => setEmail(e.target.value)} required placeholder="admin"
          autoCapitalize="none" autoComplete="username"
          aria-invalid={!!err} aria-describedby={err ? 'admin-error' : undefined}
          className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-[#00E676]/50" />
        <label htmlFor="admin-pw" className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/60">Mot de passe</label>
        <input id="admin-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} required
          autoComplete="current-password" minLength={8}
          aria-invalid={!!err} aria-describedby={err ? 'admin-error' : undefined}
          className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-[#00E676]/50" />
        {err && <p id="admin-error" role="alert" className="mt-3 text-sm text-[#FF5A4D]">{err}</p>}
        <button disabled={busy} className="mt-6 w-full rounded-lg bg-[#00E676] py-2.5 font-bold text-[#05140c] disabled:opacity-60">
          {busy ? '…' : 'Se connecter'}
        </button>
      </form>
    </Shell>
  );
}

function Console({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>('tickets');
  const [openCount, setOpenCount] = useState<number | null>(null);

  // Stable : sinon TicketsView relance loadTickets à chaque rendu du parent.
  const handleOpenCount = useCallback((n: number) => setOpenCount(n), []);

  const tabs: { id: Tab; label: string; badge?: number | null }[] = [
    { id: 'tickets', label: 'Tickets', badge: openCount },
    { id: 'analytics', label: 'Analytics' },
  ];

  return (
    <main className="flex h-screen flex-col bg-[#080A09] text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="font-bold">Strive · Support</span>
          <nav className="flex gap-1" aria-label="Sections">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="rounded-full bg-[#FFB300]/20 px-1.5 text-[10px] font-bold text-[#FFB300]">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-white/60">
          <span className="hidden sm:inline">{email}</span>
          <button onClick={() => supabase.auth.signOut()} className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">Déconnexion</button>
        </div>
      </header>

      {/* Tickets reste monté : revenir dessus ne relance pas le chargement et
          conserve le fil sélectionné. Analytics est monté à la demande, pour
          qu'aucun appel RPC ne parte tant que l'onglet n'est pas ouvert. */}
      <div className={tab === 'tickets' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <TicketsView onOpenCount={handleOpenCount} />
      </div>
      <div className={tab === 'analytics' ? 'flex min-h-0 flex-1' : 'hidden'}>
        {tab === 'analytics' && <AnalyticsView />}
      </div>
    </main>
  );
}
