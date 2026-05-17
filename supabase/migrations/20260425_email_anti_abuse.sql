-- ═══════════════════════════════════════════════════════════════════════════
-- Email auth + anti-abuse multi-comptes
-- ═══════════════════════════════════════════════════════════════════════════
-- 4 couches de défense contre la création de comptes en chaîne pour exploiter
-- les 3 scans gratuits journaliers :
--   1. Blocklist domaines jetables (yopmail, mailinator, ...)
--   2. Email normalisé + unique (anti Gmail aliases john.doe = johndoe = john+x)
--   3. Device tracking (1 device = 1 compte free)
--   4. Cooldown 60s entre signup et premier scan
--
-- Le confirm email est à activer dans le Dashboard :
--   Authentication → Providers → Email → Confirm email = ON
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Blocklist domaines jetables
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.reject_disposable_email()
returns trigger
language plpgsql
as $$
declare
  bad_domains text[] := array[
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
  ];
  domain text;
begin
  domain := lower(split_part(new.email, '@', 2));
  if domain = any(bad_domains) then
    raise exception 'disposable_email_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists block_disposable_emails on auth.users;
create trigger block_disposable_emails
  before insert on auth.users
  for each row execute function public.reject_disposable_email();


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Email normalisé + index unique (anti aliases Gmail)
-- ═══════════════════════════════════════════════════════════════════════════
-- Gmail/Googlemail traitent : john.doe@gmail.com = johndoe@gmail.com
--                             = johndoe+anything@gmail.com
-- → on stocke une version normalisée et on impose unicité.

alter table public.profiles
  add column if not exists email_normalized text;

create or replace function public.normalize_email(e text)
returns text
language sql
immutable
as $$
  select case
    -- Gmail / Googlemail : retire tout après '+', enlève les points, force gmail.com
    when lower(split_part(e, '@', 2)) in ('gmail.com', 'googlemail.com')
      then replace(split_part(lower(e), '+', 1), '.', '') || '@gmail.com'
    -- Autres providers : retire juste tout après '+', lowercase
    else split_part(lower(e), '+', 1) || '@' || split_part(lower(e), '@', 2)
  end;
$$;

-- Backfill des comptes existants
update public.profiles
  set email_normalized = public.normalize_email(email)
  where email_normalized is null and email is not null;

-- Trigger : maintient email_normalized à jour à chaque insert/update du profil
create or replace function public.set_email_normalized()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null then
    new.email_normalized := public.normalize_email(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_email_normalized on public.profiles;
create trigger trg_set_email_normalized
  before insert or update of email on public.profiles
  for each row execute function public.set_email_normalized();

-- Index unique : 1 seul compte par email normalisé
create unique index if not exists idx_profiles_email_normalized_unique
  on public.profiles (email_normalized)
  where email_normalized is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Device tracking — 1 device = 1 compte free
-- ═══════════════════════════════════════════════════════════════════════════
-- L'app génère un UUID stable au 1er lancement (AsyncStorage) et l'envoie via
-- RPC à chaque signup. Si ce device a déjà servi pour créer un compte, on bloque
-- les avantages free du nouveau compte (extra_scan_credits = 0, daily_scans_count
-- = haut pour bypasser le quota free → user doit upgrade pour scanner).

create table if not exists public.device_signups (
  device_id        text primary key,
  first_user_id    uuid references auth.users(id) on delete set null,
  signup_count     int  not null default 1,
  last_signup_at   timestamptz not null default now(),
  first_signup_at  timestamptz not null default now()
);

alter table public.device_signups enable row level security;
-- Aucune policy → seul service_role / SECURITY DEFINER lit/écrit.

create or replace function public.register_device_signup(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  existing record;
  is_multi boolean := false;
begin
  uid := auth.uid();
  if uid is null or p_device_id is null or length(p_device_id) < 16 then
    raise exception 'invalid_input';
  end if;

  select * into existing from public.device_signups where device_id = p_device_id;

  if existing.device_id is null then
    -- 1er signup sur ce device : autorisé en free tier normal
    insert into public.device_signups (device_id, first_user_id)
      values (p_device_id, uid);
  else
    -- N-ième signup sur ce device : on incrémente et on restreint le free
    update public.device_signups
      set signup_count = signup_count + 1,
          last_signup_at = now()
      where device_id = p_device_id;

    is_multi := true;

    -- Restriction du compte : tier=free mais 0 scan disponible → upgrade obligatoire
    update public.profiles
      set extra_scan_credits = 0,
          daily_scans_count = 999
      where id = uid;

    -- Audit pour suivre les abus
    insert into public.audit_log (user_id, action, details)
      values (uid, 'multi_account_blocked',
              jsonb_build_object(
                'device_id', p_device_id,
                'count', existing.signup_count + 1,
                'first_account', existing.first_user_id
              ));
  end if;

  return jsonb_build_object('multi_account', is_multi);
end;
$$;

grant execute on function public.register_device_signup(text) to authenticated;
revoke execute on function public.register_device_signup(text) from public;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Cooldown 60s entre signup et premier scan
-- ═══════════════════════════════════════════════════════════════════════════
-- Empêche les bots de chainer "signup → scan" en 2s.

create or replace function public.enforce_first_scan_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_age_s int;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  -- Premier scan du user ?
  if not exists (select 1 from public.rides where user_id = new.user_id) then
    select extract(epoch from (now() - created_at))::int into account_age_s
      from auth.users where id = new.user_id;
    if account_age_s is not null and account_age_s < 60 then
      raise exception 'account_too_new' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_account_age on public.rides;
create trigger check_account_age
  before insert on public.rides
  for each row execute function public.enforce_first_scan_cooldown();


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS À EXÉCUTER
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Disposable email :
--    insert into auth.users (email, ...) values ('test@yopmail.com', ...);
--    → ERROR: disposable_email_not_allowed
--
-- 2. Gmail aliases :
--    Créer 'john.doe@gmail.com' puis 'johndoe+x@gmail.com'
--    → 2e tentative : ERROR unique constraint idx_profiles_email_normalized_unique
--
-- 3. Multi-device :
--    select register_device_signup('aaaaaaaaaaaaaaaa-uuid-test');  -- 1er compte : ok
--    -- Logout, signup nouveau compte
--    select register_device_signup('aaaaaaaaaaaaaaaa-uuid-test');  -- 2e : multi_account=true
--    select * from audit_log where action='multi_account_blocked';
--
-- 4. Cooldown :
--    insert into rides (...) immédiatement après signup
--    → ERROR: account_too_new
