export type Status = 'open' | 'answered' | 'closed';

export interface Ticket {
  id: string;
  user_email: string | null;
  subject: string;
  status: Status;
  created_at: string;
  last_message_at: string;
}

export interface Msg {
  id: string;
  ticket_id: string;
  sender: 'user' | 'staff';
  body: string;
  created_at: string;
}

export const STATUS: Record<Status, { label: string; color: string }> = {
  open:     { label: 'À traiter', color: '#FFB300' },
  answered: { label: 'Répondu',   color: '#00E676' },
  closed:   { label: 'Fermé',     color: '#6B7280' },
};

export const fmt = (s: string) =>
  new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Forme renvoyée par le RPC `admin_analytics` (cf. migration 20260916). */
export interface Analytics {
  generated_at: string;
  window_days: number;
  users: { total: number; new_7d: number; new_30d: number; new_window: number };
  active_users: { window: number; d7: number };
  subscriptions: {
    free: number; plus: number; premium: number;
    active: number; grace: number; cancelled: number;
  };
  scans: {
    total: number; both_addresses: number; gemini_fallback: number;
    verdict_good: number; verdict_mid: number; verdict_bad: number;
  };
  scans_by_platform: { platform: string; total: number; both_addresses: number; fallback: number }[];
  scans_daily: { day: string; total: number; fallback: number }[];
  rides: {
    total: number; accepted: number; declined: number;
    avg_hourly_rate: number | null; avg_fare: number | null;
  };
  sessions: { total: number; total_hours: number; avg_hours: number };
  support: { open: number; answered: number; closed: number; new_window: number };
  support_first_reply_minutes: number | null;
}
