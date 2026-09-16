'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { VIEWS, type View } from './types';
import { supabase } from '../../lib/supabaseClient';
import TicketsView from './TicketsView';
import Home from './Home';
import DriversView from './DriversView';
import SubsView from './SubsView';
import ErrorsView from './ErrorsView';
import ActivityView from './ActivityView';


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
  const [view, setView] = useState<View>('home');
  const [days, setDays] = useState(30);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [driver, setDriver] = useState<string | null>(null);

  // La vue vit dans le fragment d'URL : le bouton Retour du navigateur ramène
  // à l'accueil au lieu de quitter la console, et un lien vers `#errors` se
  // partage. Aucun routeur à ajouter pour ça.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace('#', '') as View;
      setView(h && (h === 'home' || h in VIEWS) ? h : 'home');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const open = useCallback((v: View) => {
    window.location.hash = v === 'home' ? '' : v;
    setView(v);
  }, []);

  // Depuis l'accueil, un nom en ligne mène directement à sa fiche.
  const openDriver = useCallback((id: string) => {
    setDriver(id);
    window.location.hash = 'drivers';
    setView('drivers');
  }, []);

  // Stable : sinon TicketsView relance loadTickets à chaque rendu du parent.
  const handleOpenCount = useCallback((n: number) => setOpenCount(n), []);

  const meta = view === 'home' ? null : VIEWS[view];
  const periodic = view === 'activity' || view === 'subs' || view === 'errors';

  return (
    <main className="flex h-screen flex-col bg-[#0A120E] text-[#E9F5EE]">
      {/* ── Barre de navigation ─────────────────────────────────────────
          Même matériau que le reste : l'onglet actif est un contenant de
          verre, l'inactif s'éteint en intensité sans perdre sa place (B3).
          Aucun aplat de couleur — la DA réserve le plein à l'exception. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] px-4 py-2.5">
        <button
          onClick={() => open('home')}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold tracking-tight outline-none transition-colors duration-150
                      focus-visible:ring-1 focus-visible:ring-[#00E676]/60 ${
            view === 'home' ? 'bg-white/[0.07] text-[#E9F5EE]' : 'text-[#8B958E] hover:text-[#E9F5EE]'
          }`}
        >
          Strive
        </button>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {(Object.keys(VIEWS) as Exclude<View, 'home'>[]).map((k) => {
            const on = view === k;
            return (
              <button
                key={k}
                onClick={() => open(k)}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none
                            transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#00E676]/60 ${
                  on ? 'bg-white/[0.07] text-[#E9F5EE]' : 'text-[#8B958E] hover:text-[#E9F5EE]'
                }`}
              >
                {VIEWS[k].title}
                {k === 'tickets' && openCount ? (
                  <span className="rounded-full bg-[#FFC24B]/15 px-1.5 text-[10px] font-bold text-[#FFC24B]">
                    {openCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {periodic && (
          <div className="flex gap-1 rounded-xl border border-white/[0.08] p-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold outline-none transition-colors duration-150 ${
                  days === d ? 'bg-white/[0.07] text-[#E9F5EE]' : 'text-[#8B958E] hover:text-[#E9F5EE]'
                }`}
              >
                {d} j
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-[#8B958E]">
          <span className="hidden sm:inline">{email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-xl border border-white/[0.08] px-3 py-1.5 text-[#8B958E] outline-none transition-colors duration-150 hover:text-[#E9F5EE] focus-visible:ring-1 focus-visible:ring-[#00E676]/60"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {meta && (
        <div className="flex items-baseline gap-3 border-b border-white/[0.07] px-5 py-3">
          <h1 className="text-base font-semibold text-[#E9F5EE]">{meta.title}</h1>
          <p className="min-w-0 flex-1 truncate text-xs text-[#5B655E]">{meta.sub}</p>
        </div>
      )}

      {/* Tickets reste monté : revenir dessus conserve le fil sélectionné et
          ne relance pas le chargement. Les autres vues se montent à la
          demande — aucun appel RPC ne part pour une page fermée. */}
      <div className={view === 'home' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <Home onOpen={open} onDriver={openDriver} />
      </div>
      <div className={view === 'tickets' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <TicketsView onOpenCount={handleOpenCount} />
      </div>
      <div className={view === 'drivers' ? 'flex min-h-0 flex-1' : 'hidden'}>
        {view === 'drivers' && <DriversView initialDriver={driver} />}
      </div>
      {(view === 'activity' || view === 'subs' || view === 'errors') && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-5 sm:p-8">
            {view === 'activity' && <ActivityView days={days} />}
            {view === 'subs' && <SubsView days={days} />}
            {view === 'errors' && <ErrorsView days={days} />}
          </div>
        </div>
      )}
    </main>
  );
}
