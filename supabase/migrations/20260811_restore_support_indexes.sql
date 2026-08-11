-- ═══════════════════════════════════════════════════════════════════════════
-- Rétablit les index du support, supprimés sur un critère invalide
-- ═══════════════════════════════════════════════════════════════════════════
-- `20260806_drop_unused_indexes.sql` les a supprimés au motif que
-- `pg_stat_user_indexes.idx_scan = 0`. Mais la fonctionnalité support a été
-- livrée dans la MÊME branche : zéro scan est la conséquence attendue de zéro
-- ticket, pas la preuve que l'index est inutile. Le fichier appliquait d'ailleurs
-- déjà ce raisonnement correctement à `idx_profiles_email_normalized_unique`,
-- qu'il a choisi de conserver malgré `idx_scan = 0`.
--
-- `idx_support_messages_ticket (ticket_id, created_at)` est le plus coûteux à
-- perdre : il sert à la fois `fetchMessages()` et le sous-select
-- `exists (select 1 from support_tickets …)` de la policy RLS `messages_select`,
-- donc chaque lecture de message y passe.
--
-- Définitions identiques à `20260702_support_tickets.sql`. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.support_tickets') is not null then
    execute 'create index if not exists idx_support_tickets_user
               on public.support_tickets(user_id)';
    execute 'create index if not exists idx_support_tickets_status
               on public.support_tickets(status, last_message_at desc)';
  end if;

  if to_regclass('public.support_messages') is not null then
    execute 'create index if not exists idx_support_messages_ticket
               on public.support_messages(ticket_id, created_at)';
  end if;
end $$;
