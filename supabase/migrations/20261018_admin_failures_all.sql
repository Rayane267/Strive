-- Liste complète des scan_failures d'une fenêtre, pour la console.
--
-- `admin_feed` n'en rend que les dernières (25, 100 au plus) et la console en
-- retire les refus et les cartes non affichées. Ici : TOUT, du plus récent au
-- plus ancien, par pages, avec le total de la fenêtre pour savoir où on en est.

create or replace function public.admin_failures(
  p_days   int default 30,
  p_limit  int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_days   int         := greatest(1, least(365, coalesce(p_days, 30)));
  v_limit  int         := greatest(1, least(500, coalesce(p_limit, 100)));
  v_offset int         := greatest(0, coalesce(p_offset, 0));
  v_since  timestamptz := now() - make_interval(days => v_days);
begin
  if not public.is_admin() then
    raise exception 'admin_failures: accès réservé aux administrateurs'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total', (
      select count(*) from public.scan_failures f
      where coalesce(f.occurred_at, f.created_at) >= v_since
    ),
    'rows', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
      from (
        select
          coalesce(f.occurred_at, f.created_at) as at,
          f.reason, f.os, f.surface, f.platform, f.detail, f.app_version,
          coalesce(p.email, u.email) as email,
          public.scan_failure_capture(f.user_id, f.reason, f.created_at) as capture
        from public.scan_failures f
        left join public.profiles p on p.id = f.user_id
        left join auth.users     u on u.id = f.user_id
        where coalesce(f.occurred_at, f.created_at) >= v_since
        order by coalesce(f.occurred_at, f.created_at) desc
        limit v_limit offset v_offset
      ) x
    )
  );
end;
$$;

revoke execute on function public.admin_failures(int, int, int) from public;
grant  execute on function public.admin_failures(int, int, int) to authenticated;
