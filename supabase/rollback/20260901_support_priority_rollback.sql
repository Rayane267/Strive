-- Rollback de 20260901_support_priority.sql
--
-- La colonne est conservée : la supprimer perdrait la priorité des tickets déjà
-- ouverts, et elle est inerte sans ses triggers.
drop trigger if exists trg_support_tickets_priority_ins on public.support_tickets;
drop trigger if exists trg_support_tickets_priority_upd on public.support_tickets;
drop function if exists public.set_ticket_priority();
drop index if exists public.idx_support_tickets_priority;

-- `effective_tier` n'est référencée que par le trigger ci-dessus. Si une autre
-- migration s'est mise à l'utiliser entre-temps, garder la fonction.
drop function if exists public.effective_tier(uuid);
