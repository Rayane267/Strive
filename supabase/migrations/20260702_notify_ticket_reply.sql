-- ═══════════════════════════════════════════════════════════════════════════
-- Push "le support a répondu" — trigger sur les messages staff
-- ═══════════════════════════════════════════════════════════════════════════
-- Quand un message sender='staff' est inséré (réponse depuis le back-office web),
-- on appelle l'edge function notify-ticket-reply via pg_net → elle push le
-- propriétaire du ticket. RÉSILIENT : toute erreur d'envoi est avalée pour ne
-- JAMAIS bloquer l'enregistrement du message.
--
-- Réutilise pg_net + les secrets Vault (project_url, service_role_key) déjà mis
-- en place pour notify-untagged (migration 20260702_untagged_nudge.sql).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

create or replace function public.notify_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender = 'staff' then
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/notify-ticket-reply',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := jsonb_build_object('ticket_id', new.ticket_id)
      );
    exception when others then
      -- Notif best-effort : on n'échoue jamais l'insert du message pour ça.
      null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_ticket_reply on public.support_messages;
create trigger trg_notify_ticket_reply
  after insert on public.support_messages
  for each row execute function public.notify_ticket_reply();
