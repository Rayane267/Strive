-- ═══════════════════════════════════════════════════════════════════════════
-- Refonte du device tracking : quota signup uniquement, pas de blocage au login
-- ═══════════════════════════════════════════════════════════════════════════
-- Décision audit :
--   - L'ancien système flaggait les users légitimes au logout/login (bug #2).
--   - L'ancien système bloquait COMPLÈTEMENT un user multi-account (faux positif
--     douloureux quand un device d'occasion ou un reset survient).
--
-- Nouvelle politique :
--   - 5 signups max par device sur une fenêtre rolling de 60 jours.
--   - Au-delà → erreur claire à l'inscription : "trop de comptes créés avec
--     ce téléphone, réessayez ultérieurement".
--   - Le login n'est PAS affecté → un user existant n'est jamais bloqué.
--   - La RPC est callable par anon (avant signUp Supabase) → check préventif.
--
-- Bypass connu : désinstaller l'app vide le device_id AsyncStorage. C'est
-- accepté : on dissuade, on n'empêche pas absolument. Les autres protections
-- (confirm email, normalize, blocklist, cooldown 60s) couvrent les flux résiduels.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Reset des faux positifs hérités de l'ancien hack daily_scans_count = 999
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  perform set_config('app.bypass_tier_check', 'on', true);
  update public.profiles
    set daily_scans_count = 0
    where daily_scans_count >= 999;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Drop l'ancienne RPC bloquante
-- ═══════════════════════════════════════════════════════════════════════════
-- DROP FUNCTION révoque automatiquement les privilèges → pas besoin de REVOKE
-- (qui d'ailleurs plante si la fonction n'existe pas).
drop function if exists public.register_device_signup(text);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Refonte de la table device_signups en log append-only
-- ═══════════════════════════════════════════════════════════════════════════
-- Ancien schéma : 1 row par device avec compteur cumulé. Limitait à 1 lock
-- définitif. Nouveau schéma : 1 row par signup, fenêtre rolling 60j calculée
-- au moment du check. Pas de migration de données : les anciens flags étaient
-- des faux positifs majoritairement.
drop table if exists public.device_signups cascade;

create table public.device_signups (
  id          bigserial primary key,
  device_id   text not null,
  created_at  timestamptz not null default now()
);

create index idx_device_signups_device_created
  on public.device_signups (device_id, created_at desc);

alter table public.device_signups enable row level security;
-- Aucune policy → seul service_role / SECURITY DEFINER lit/écrit.


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RPC check_and_register_device_signup
-- ═══════════════════════════════════════════════════════════════════════════
-- Appelée AVANT supabase.auth.signUp() côté client. Si la limite est atteinte,
-- raise une exception → le client affiche le message et n'envoie même pas la
-- requête signUp à Supabase Auth.
--
-- Callable par anon : la création de compte n'est pas authentifiée à ce stade.
-- Le risque de spam de cette RPC est mitigé par sa légèreté (1 COUNT indexé +
-- 1 INSERT) et la possibilité d'ajouter un rate-limit Cloudflare plus tard.

create or replace function public.check_and_register_device_signup(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
  window_start timestamptz := now() - interval '60 days';
begin
  if p_device_id is null or length(p_device_id) < 16 then
    raise exception 'invalid_device_id' using errcode = 'P0001';
  end if;

  select count(*) into recent_count
    from public.device_signups
    where device_id = p_device_id
      and created_at >= window_start;

  if recent_count >= 5 then
    raise exception 'device_signup_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.device_signups (device_id) values (p_device_id);
end;
$$;

revoke execute on function public.check_and_register_device_signup(text) from public;
grant execute on function public.check_and_register_device_signup(text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Faux positifs reset :
--    select id, daily_scans_count from profiles where daily_scans_count >= 999;
--    → 0 lignes
--
-- 2. 5 signups consécutifs OK, 6e bloqué :
--    select check_and_register_device_signup('aaaaaaaaaaaaaaaa-test');  -- ×5 OK
--    select check_and_register_device_signup('aaaaaaaaaaaaaaaa-test');  -- 6e
--    → ERROR: device_signup_limit_reached
--
-- 3. Device ID trop court rejeté :
--    select check_and_register_device_signup('short');
--    → ERROR: invalid_device_id
