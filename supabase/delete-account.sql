-- Account deletion. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Lets a signed-in member delete their own account (and cloud-saved data), and lets an admin delete a member.
-- Anonymous usage events are kept but detached from the person (uid is cleared).

create or replace function public.ttm_delete_me() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.ttm_profiles where id = auth.uid() and is_admin)
     and (select count(*) from public.ttm_profiles where is_admin) <= 1 then
    raise exception 'you are the only admin; make another admin first';
  end if;
  if to_regclass('public.ttm_events') is not null then execute 'update public.ttm_events set uid = null where uid = $1' using auth.uid(); end if;
  delete from auth.users where id = auth.uid();    -- profile and cloud data are removed with it (on delete cascade)
end $$;
revoke all on function public.ttm_delete_me() from public, anon;
grant execute on function public.ttm_delete_me() to authenticated;

create or replace function public.ttm_admin_delete_user(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  if p_id = auth.uid() then raise exception 'use "Delete my account" for your own account'; end if;
  if to_regclass('public.ttm_events') is not null then execute 'update public.ttm_events set uid = null where uid = $1' using p_id; end if;
  delete from auth.users where id = p_id;
end $$;
revoke all on function public.ttm_admin_delete_user(uuid) from public, anon;
grant execute on function public.ttm_admin_delete_user(uuid) to authenticated;
