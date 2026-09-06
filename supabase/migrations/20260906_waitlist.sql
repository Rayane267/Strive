-- ═══════════════════════════════════════════════════════════════════════════
-- Waitlist — inscriptions avant le lancement (landing web /waitlist)
-- ═══════════════════════════════════════════════════════════════════════════
-- La table n'est JAMAIS lisible ni écrivable directement par anon : tout passe
-- par la RPC public.join_waitlist() (SECURITY DEFINER) qui valide le format,
-- rejette les emails jetables, dé-duplique sur l'email normalisé et renvoie la
-- position dans la file. Lecture réservée aux admins (profiles.is_admin).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.waitlist (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  email_normalized text not null,
  source           text,           -- 'landing', 'instagram', 'x', … (utm_source)
  locale           text,           -- langue du navigateur ('fr', 'en', …)
  referrer         text,           -- document.referrer tronqué
  notified_at      timestamptz,    -- rempli quand l'invitation de lancement part
  created_at       timestamptz not null default now()
);

create unique index if not exists idx_waitlist_email_normalized
  on public.waitlist (email_normalized);
create index if not exists idx_waitlist_created_at
  on public.waitlist (created_at);

-- ── RLS : aucune policy pour anon/authenticated → accès direct impossible ───
alter table public.waitlist enable row level security;

drop policy if exists waitlist_admin_read on public.waitlist;
create policy waitlist_admin_read on public.waitlist
  for select using (public.is_admin());

revoke all on public.waitlist from anon, authenticated;
grant select on public.waitlist to authenticated;  -- filtré par la policy admin

-- ── Domaines jetables ──────────────────────────────────────────────────────
create or replace function public.is_disposable_email(e text)
returns boolean
language sql
immutable
as $$
  select lower(split_part(e, '@', 2)) = any (array[
    'yopmail.com', 'yopmail.fr', 'yopmail.net',
    'mailinator.com', 'mailinator.net',
    'tempmail.com', 'tempmail.net', 'temp-mail.org', 'temp-mail.io',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
    '10minutemail.com', '10minutemail.net',
    'throwaway.email', 'throwawaymail.com',
    'dispostable.com', 'sharklasers.com', 'getairmail.com',
    'fakeinbox.com', 'trashmail.com', 'maildrop.cc',
    'spamgourmet.com', 'mintemail.com', 'tempinbox.com', 'mailcatch.com',
    'inboxbear.com', 'emailondeck.com', 'spam4.me',
    'mohmal.com', 'fakemailgenerator.com', 'getnada.com',
    'mytemp.email', 'tempmailaddress.com', 'tempmailo.com',
    'mailtemp.info', 'mail-temp.com', 'tempr.email'
  ]);
$$;

-- ── RPC d'inscription ──────────────────────────────────────────────────────
-- Renvoie { position, already_registered, total }.
-- Erreurs métier levées : invalid_email / disposable_email_not_allowed.
create or replace function public.join_waitlist(
  p_email    text,
  p_source   text default null,
  p_locale   text default null,
  p_referrer text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text := lower(btrim(p_email));
  v_normalized text;
  v_id         uuid;
  v_created    timestamptz;
  v_already    boolean := false;
  v_position   int;
begin
  if v_email is null or char_length(v_email) > 254
     or v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  if public.is_disposable_email(v_email) then
    raise exception 'disposable_email_not_allowed' using errcode = 'P0001';
  end if;

  v_normalized := public.normalize_email(v_email);

  insert into public.waitlist (email, email_normalized, source, locale, referrer)
  values (
    v_email,
    v_normalized,
    nullif(left(coalesce(p_source, ''), 60), ''),
    nullif(left(coalesce(p_locale, ''), 10), ''),
    nullif(left(coalesce(p_referrer, ''), 200), '')
  )
  on conflict (email_normalized) do nothing
  returning id, created_at into v_id, v_created;

  if v_id is null then
    v_already := true;
    select id, created_at into v_id, v_created
      from public.waitlist where email_normalized = v_normalized;
  end if;

  select count(*) into v_position
    from public.waitlist where created_at <= v_created;

  return jsonb_build_object(
    'position', v_position,
    'already_registered', v_already,
    'total', (select count(*) from public.waitlist)
  );
end;
$$;

revoke all on function public.join_waitlist(text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, text)
  to anon, authenticated;

-- Compteur public (affiché sur la landing) sans exposer les emails.
create or replace function public.waitlist_count()
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from public.waitlist;
$$;

revoke all on function public.waitlist_count() from public;
grant execute on function public.waitlist_count() to anon, authenticated;
