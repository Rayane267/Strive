-- ═══════════════════════════════════════════════════════════════════════════
-- Support tickets — fil de discussion user ↔ staff
-- ═══════════════════════════════════════════════════════════════════════════
-- Users (app) : ouvrent un ticket + répondent, voient uniquement les leurs.
-- Staff (back-office web) : voient/répondent à tout, via le flag profiles.is_admin.
-- Notification push (staff → user) : gérée par l'edge function notify-ticket-reply
-- (déclenchée après un message staff).
-- ═══════════════════════════════════════════════════════════════════════════

-- Flag admin (back-office). À poser à true manuellement sur ton compte :
--   update public.profiles set is_admin = true where id = '<ton-uuid>';
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  user_email      text,  -- dénormalisé à la création → l'admin sait qui écrit sans lire profiles
  subject         text not null check (char_length(subject) between 1 and 140),
  status          text not null default 'open'
                    check (status in ('open', 'answered', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists idx_support_tickets_user on public.support_tickets(user_id);
create index if not exists idx_support_tickets_status on public.support_tickets(status, last_message_at desc);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  sender     text not null check (sender in ('user', 'staff')),
  author_id  uuid,  -- auteur (user ou admin) ; null toléré pour un envoi système
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_support_messages_ticket on public.support_messages(ticket_id, created_at);

-- ── Helper is_admin() (SECURITY DEFINER → pas de récursion RLS) ─────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── Trigger : à chaque message, met à jour le ticket (statut + horodatage) ──
create or replace function public.touch_ticket_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_tickets
     set last_message_at = new.created_at,
         updated_at      = new.created_at,
         -- staff répond → 'answered' ; user écrit → (ré)ouvre en 'open'
         status = case
           when new.sender = 'staff' then 'answered'
           else 'open'
         end
   where id = new.ticket_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_ticket_on_message on public.support_messages;
create trigger trg_touch_ticket_on_message
  after insert on public.support_messages
  for each row execute function public.touch_ticket_on_message();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

-- Tickets : le propriétaire OU un admin peut lire ; seul le propriétaire crée ;
-- seul un admin met à jour (changement de statut / fermeture).
drop policy if exists "tickets_select" on public.support_tickets;
create policy "tickets_select" on public.support_tickets
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "tickets_insert" on public.support_tickets;
create policy "tickets_insert" on public.support_tickets
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "tickets_update" on public.support_tickets;
create policy "tickets_update" on public.support_tickets
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Messages : lecture par le propriétaire du ticket ou un admin.
drop policy if exists "messages_select" on public.support_messages;
create policy "messages_select" on public.support_messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.user_id = auth.uid()
    )
  );

-- Écriture : soit le user sur SON ticket (sender=user), soit un admin (sender=staff).
drop policy if exists "messages_insert" on public.support_messages;
create policy "messages_insert" on public.support_messages
  for insert to authenticated
  with check (
    (
      sender = 'user'
      and author_id = auth.uid()
      and exists (
        select 1 from public.support_tickets t
        where t.id = ticket_id and t.user_id = auth.uid()
      )
    )
    or (
      sender = 'staff' and public.is_admin()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Setup : marquer ton compte admin →
--   update public.profiles set is_admin = true where id = '<ton-uuid>';
-- ═══════════════════════════════════════════════════════════════════════════
