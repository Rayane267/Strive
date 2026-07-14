import { supabase } from './supabase';

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender: 'user' | 'staff';
  body: string;
  created_at: string;
}

/** Tickets de l'utilisateur courant (RLS restreint déjà aux siens), plus récent d'abord. */
export async function fetchTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, subject, status, created_at, updated_at, last_message_at')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupportTicket[];
}

/** Fil d'un ticket (ordre chronologique). */
export async function fetchMessages(ticketId: string): Promise<SupportMessage[]> {
  const { data, error } = await supabase
    .from('support_messages')
    .select('id, ticket_id, sender, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SupportMessage[];
}

/** Crée un ticket + son premier message. Renvoie l'id du ticket. */
export async function createTicket(subject: string, body: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('not_authenticated');

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .insert({ user_id: uid, user_email: userData.user?.email ?? null, subject: subject.trim() })
    .select('id')
    .single();
  if (tErr) throw tErr;

  const { error: mErr } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticket.id, sender: 'user', author_id: uid, body: body.trim() });
  if (mErr) throw mErr;

  return ticket.id as string;
}

/** Réponse de l'utilisateur dans un ticket existant. */
export async function postUserMessage(ticketId: string, body: string): Promise<SupportMessage> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('not_authenticated');

  const { data, error } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticketId, sender: 'user', author_id: uid, body: body.trim() })
    .select('id, ticket_id, sender, body, created_at')
    .single();
  if (error) throw error;
  return data as SupportMessage;
}
