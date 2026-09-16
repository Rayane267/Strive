'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { STATUS, fmt, type Msg, type Status, type Ticket } from './types';

export default function TicketsView({ onOpenCount }: { onOpenCount?: (n: number) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sel, setSel] = useState<Ticket | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const endRef = useRef<HTMLDivElement>(null);

  const loadTickets = useCallback(async () => {
    const { data } = await supabase.from('support_tickets')
      .select('id, user_email, subject, status, created_at, last_message_at')
      .order('last_message_at', { ascending: false });
    const rows = (data ?? []) as Ticket[];
    setTickets(rows);
    onOpenCount?.(rows.filter(t => t.status !== 'closed').length);
  }, [onOpenCount]);

  const loadMsgs = useCallback(async (ticketId: string) => {
    const { data } = await supabase.from('support_messages')
      .select('id, ticket_id, sender, body, created_at')
      .eq('ticket_id', ticketId).order('created_at', { ascending: true });
    setMsgs((data ?? []) as Msg[]);
    requestAnimationFrame(() => endRef.current?.scrollIntoView());
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { if (sel) loadMsgs(sel.id); }, [sel, loadMsgs]);

  const send = async () => {
    if (!sel || !reply.trim() || busy) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('support_messages')
      .insert({ ticket_id: sel.id, sender: 'staff', author_id: u.user?.id, body: reply.trim() });
    if (!error) { setReply(''); await loadMsgs(sel.id); await loadTickets(); }
    setBusy(false);
  };

  const close = async () => {
    if (!sel) return;
    await supabase.from('support_tickets').update({ status: 'closed' }).eq('id', sel.id);
    await loadTickets();
    setSel(s => s ? { ...s, status: 'closed' } : s);
  };

  const shown = tickets.filter(t => filter === 'all' || t.status === filter);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Liste */}
      <aside className="flex w-80 flex-none flex-col border-r border-white/10">
        <div className="flex gap-1 border-b border-white/10 p-2">
          {(['all', 'open', 'answered', 'closed'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${filter === f ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/70'}`}>
              {f === 'all' ? 'Tous' : STATUS[f].label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 && <p className="p-6 text-center text-sm text-white/40">Aucun ticket.</p>}
          {shown.map(t => (
            <button key={t.id} onClick={() => setSel(t)}
              className={`block w-full border-b border-white/5 px-4 py-3 text-left hover:bg-white/[0.03] ${sel?.id === t.id ? 'bg-white/[0.05]' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{t.subject}</span>
                <span className="flex-none rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: STATUS[t.status].color + '22', color: STATUS[t.status].color }}>{STATUS[t.status].label}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-white/45">
                <span className="truncate">{t.user_email ?? '—'}</span>
                <span className="flex-none">{fmt(t.last_message_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Fil */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!sel ? (
          <div className="flex flex-1 items-center justify-center text-white/40">Sélectionne un ticket</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{sel.subject}</p>
                <p className="text-xs text-white/45">{sel.user_email ?? '—'} · ouvert le {fmt(sel.created_at)}</p>
              </div>
              {sel.status !== 'closed' && (
                <button onClick={close} className="flex-none rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">Clôturer</button>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {msgs.map(m => (
                <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${m.sender === 'staff' ? 'bg-[#00E676] text-[#05140c]' : 'border border-white/10 bg-[#0F1311]'}`}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                    <p className={`mt-1 text-[10px] ${m.sender === 'staff' ? 'text-[#05140c]/60' : 'text-white/40'}`}>{fmt(m.created_at)}</p>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <div className="flex items-end gap-2 border-t border-white/10 p-3">
              <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
                aria-label="Réponse au ticket"
                placeholder="Réponse… (Ctrl/⌘+Entrée pour envoyer)"
                className="min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-[#00E676]/50" />
              <button onClick={send} disabled={busy || !reply.trim()}
                className="flex-none rounded-xl bg-[#00E676] px-5 py-2.5 font-bold text-[#05140c] disabled:opacity-50">
                {busy ? '…' : 'Envoyer'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
