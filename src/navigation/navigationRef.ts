import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

/**
 * Navigue depuis une notification (tap). Gère le cold start : si la navigation
 * n'est pas encore prête (app lancée depuis l'état tué), on réessaie brièvement.
 */
export function navigateFromNotification(data?: Record<string, string>, attempt = 0) {
  if (!data) return;
  if (!navigationRef.isReady()) {
    if (attempt < 20) setTimeout(() => navigateFromNotification(data, attempt + 1), 250);
    return;
  }
  if (data.type === 'ticket_reply' && data.ticket_id) {
    navigationRef.navigate('SupportTicketDetail', {
      ticketId: data.ticket_id,
      subject: data.subject ?? '',
    });
  }
}
