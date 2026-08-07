import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { supabase } from './supabase';
import { APP_VERSION_LABEL } from '../utils/appVersion';

export type TicketStatus = 'open' | 'answered' | 'closed';

/**
 * Taxonomie du support — source unique, alignée sur les contraintes CHECK de
 * `20260808_support_category.sql`. Vocabulaire FERMÉ : une catégorie libre
 * redeviendrait du vrac au bout d'un mois.
 *
 * Les sous-catégories sont PRÉFIXÉES par leur catégorie. Ce n'est pas cosmétique :
 * la base garantit l'appariement avec un simple `subcategory like category || '.%'`,
 * au lieu d'énumérer toutes les combinaisons valides.
 *
 * `suggestion` et `other` n'ont pas de sous-catégorie — découper une suggestion
 * n'apporte rien, et « autre » ne se subdivise pas par définition. L'UI saute
 * alors l'étape plutôt que d'afficher une liste vide.
 *
 * Libellés : `support.cat.<catégorie>` et `support.sub.<sous-catégorie>`.
 */
export const TICKET_TAXONOMY = {
  scan:         ['no_detect', 'wrong_values', 'addresses', 'trigger', 'display'],
  subscription: ['purchase', 'restore', 'billing', 'cancel'],
  account:      ['login', 'profile', 'delete'],
  data:         ['missing_ride', 'wrong_stats', 'export'],
  suggestion:   [],
  other:        [],
} as const;

export const TICKET_CATEGORIES = Object.keys(TICKET_TAXONOMY) as TicketCategory[];
export type TicketCategory = keyof typeof TICKET_TAXONOMY;

/** Sous-catégories d'une catégorie, déjà préfixées — prêtes pour la base. */
export function subcategoriesFor(category: TicketCategory): string[] {
  return TICKET_TAXONOMY[category].map(s => `${category}.${s}`);
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  /** Préfixée par sa catégorie (« scan.addresses »), ou null. */
  subcategory: string | null;
  /** Code que l'utilisateur a rattaché lui-même, ou null. */
  error_code: string | null;
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
    .select('id, subject, status, category, subcategory, error_code, created_at, updated_at, last_message_at')
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

// ─── Contexte de diagnostic joint au premier message ──────────────────────────
//
// Un ticket « le scan marche pas » sans version ni appareil coûte trois
// allers-retours avant de savoir de quoi on parle. On joint donc au corps du
// message ce qu'on sait déjà : version, plateforme, modèle. Le code d'erreur,
// lui, est désigné par l'utilisateur et vit dans `support_tickets.error_code`.
//
// Volontairement dans le `body` plutôt que dans une colonne dédiée : aucune
// migration, visible immédiatement côté admin, et — important — LISIBLE PAR LE
// CHAUFFEUR. Rien n'est collecté à son insu.

/** `support_messages.body` est plafonné à 4000 caractères par un CHECK en base. */
const BODY_MAX = 4000;

function buildContextBlock(): string {
  const lines: string[] = [
    `Strive ${APP_VERSION_LABEL} · ${Platform.OS} ${String(Platform.Version)}`,
  ];

  // getModel est synchrone et ne throw pas, mais on isole quand même : un
  // contexte manquant ne doit jamais empêcher l'envoi d'un ticket.
  try {
    lines.push(DeviceInfo.getModel());
  } catch {
    /* modèle indisponible — on s'en passe */
  }

  // Plus de « dernier échec » deviné ici : l'utilisateur DÉSIGNE désormais le
  // code qui motive son ticket, et il part dans la colonne `error_code` — qui se
  // filtre et s'agrège, contrairement à une ligne de texte dans le message.
  return `\n\n—————\n${lines.join(' · ')}`;
}

/**
 * Crée un ticket + son premier message. Renvoie l'id du ticket.
 *
 * `category` / `subcategory` trient la file de support ; `errorCode` est le code
 * que l'utilisateur a rattaché parmi ses erreurs récentes (null s'il n'en a
 * désigné aucune).
 */
export async function createTicket(
  subject: string,
  body: string,
  category: TicketCategory = 'other',
  subcategory: string | null = null,
  errorCode: string | null = null,
): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('not_authenticated');

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .insert({
      user_id: uid,
      user_email: userData.user?.email ?? null,
      subject: subject.trim(),
      category,
      // Garde-fou local en plus du CHECK : une sous-catégorie d'une AUTRE
      // catégorie serait rejetée par la base, ce qui ferait perdre le ticket.
      subcategory: subcategory && subcategory.startsWith(`${category}.`) ? subcategory : null,
      error_code: errorCode,
    })
    .select('id')
    .single();
  if (tErr) throw tErr;

  // Contexte best-effort : s'il échoue, le ticket part quand même.
  let context = '';
  try {
    context = buildContextBlock();
  } catch {
    /* pas de contexte — le ticket reste prioritaire */
  }

  // Le CHECK en base rejette au-delà de 4000 caractères : on tronque le message
  // de l'utilisateur plutôt que le contexte, qui est court et exploitable.
  const trimmed = body.trim();
  const room = BODY_MAX - context.length;
  const finalBody =
    trimmed.length <= room ? trimmed + context : trimmed.slice(0, room - 1) + '…' + context;

  const { error: mErr } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticket.id, sender: 'user', author_id: uid, body: finalBody });
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
