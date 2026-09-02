-- ═══════════════════════════════════════════════════════════════════════════
-- Support prioritaire : les tickets Premium passent devant
-- ═══════════════════════════════════════════════════════════════════════════
-- Premium promet une réponse prioritaire. Cette promesse ne peut pas vivre
-- côté client : n'importe quel compte peut poster
--   POST /rest/v1/support_tickets  {"priority": true}
-- et se placer en tête de file. La priorité est donc calculée EN BASE, à
-- l'insertion, à partir du tier réellement porté par le profil.
--
-- Décidée UNE FOIS, à l'ouverture du ticket, puis figée :
--   • un abonné qui résilie pendant l'échange garde la priorité du fil qu'il a
--     ouvert en Premium — lui la retirer en cours de conversation serait une
--     reprise sur un service déjà commencé ;
--   • et à l'inverse, passer Premium ne fait pas remonter d'anciens tickets,
--     ce qui rendrait la file instable à chaque achat.
-- D'où deux triggers : INSERT calcule, UPDATE recopie l'ancienne valeur.
--
-- Le tier lu est le tier EFFECTIF (abo expiré = free, sauf période de grâce),
-- même règle que `enforce_scan_quota` et que `getEffectivePlanTier` côté app.
-- Il est extrait ici en fonction nommée : la logique était jusqu'à présent
-- recopiée en ligne dans chaque RPC qui en avait besoin.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.support_tickets
  add column if not exists priority boolean not null default false;

-- ─── Tier effectif, en une fonction plutôt qu'un case recopié ────────────────
-- SECURITY DEFINER : le trigger doit pouvoir lire `profiles` quel que soit
-- l'appelant. Sans ça, la priorité dépendrait des policies RLS du moment.
-- STABLE et search_path figé : pas de résolution de schéma détournable.
create or replace function public.effective_tier(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when coalesce(p.subscription_tier, 'free') <> 'free'
                and p.subscription_expires_at is not null
                and p.subscription_expires_at < now()
                and not (
                  p.subscription_status = 'in_grace_period'
                  and p.subscription_expires_at > now() - interval '16 days'
                )
             then 'free'
           else coalesce(p.subscription_tier, 'free')
         end
  from public.profiles p
  where p.id = p_user;
$$;

comment on function public.effective_tier(uuid) is
  'Tier réellement porté par un profil : un abonnement expiré retombe à ''free'', sauf pendant les 16 jours de période de grâce. Miroir de getEffectivePlanTier (src/services/subscriptionService.ts).';

-- ─── Priorité posée par la base, jamais par le client ────────────────────────
create or replace function public.set_ticket_priority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- La valeur envoyée par le client est ignorée, pas rejetée : un ticket ne
    -- doit jamais échouer parce que son auteur a bricolé le payload.
    new.priority := coalesce(public.effective_tier(new.user_id), 'free') = 'premium';
  else
    -- Figée après coup. Voir l'en-tête : ni retirée à la résiliation, ni
    -- accordée rétroactivement par un achat.
    new.priority := old.priority;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_support_tickets_priority_ins on public.support_tickets;
create trigger trg_support_tickets_priority_ins
  before insert on public.support_tickets
  for each row execute function public.set_ticket_priority();

drop trigger if exists trg_support_tickets_priority_upd on public.support_tickets;
create trigger trg_support_tickets_priority_upd
  before update on public.support_tickets
  for each row execute function public.set_ticket_priority();

-- La file d'attente se lit « prioritaires d'abord, puis du plus ancien message
-- au plus récent ». L'index porte exactement ce tri.
create index if not exists idx_support_tickets_priority
  on public.support_tickets(priority desc, last_message_at desc);

comment on column public.support_tickets.priority is
  'Ticket ouvert par un compte Premium. Posé par trigger à l''insertion, immuable ensuite — le client ne peut pas l''écrire.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Connecté en tant que chauffeur FREE ou PLUS, la priorité réclamée est
--    ignorée :
--      insert into public.support_tickets (user_id, subject, priority)
--        values (auth.uid(), 'test', true) returning priority;
--      → false
--
-- 2. Connecté en tant que chauffeur PREMIUM, elle est accordée sans rien
--    demander :
--      insert into public.support_tickets (user_id, subject)
--        values (auth.uid(), 'test') returning priority;
--      → true
--
-- 3. Elle ne bouge plus ensuite :
--      update public.support_tickets set priority = true
--        where id = '<ticket free>' returning priority;
--      → false
--
-- 4. Un abonnement expiré hors période de grâce ne vaut plus priorité :
--      select public.effective_tier('<uid premium expiré>');
--      → 'free'
