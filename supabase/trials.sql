-- Time-limited plans (giveaways, trials, paid-until dates). Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- A member with plan_until set keeps their plan until that moment, then drops back to Free automatically.
-- (The site also treats an expired plan as Free straight away, so nothing depends on the clean-up below running on time.)

alter table public.ttm_profiles add column if not exists plan_until timestamptz;
alter table public.ttm_profiles add column if not exists plan_note text;   -- e.g. 'giveaway', 'paid', 'trial'

-- Anyone signed in can tidy up their own expired plan.
create or replace function public.ttm_expire_me() returns void
language sql security definer set search_path = public as $$
  update public.ttm_profiles set plan = 'free', plan_until = null
   where id = auth.uid() and plan_until is not null and plan_until < now() and not is_admin;
$$;
revoke all on function public.ttm_expire_me() from public, anon;
grant execute on function public.ttm_expire_me() to authenticated;

-- Everyone's expired plans, in one go (admins; also run on a schedule below).
create or replace function public.ttm_expire_plans() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.ttm_is_admin() then raise exception 'admins only'; end if;
  update public.ttm_profiles set plan = 'free', plan_until = null
   where plan_until is not null and plan_until < now() and not is_admin;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.ttm_expire_plans() from public, anon;
grant execute on function public.ttm_expire_plans() to authenticated;

-- Grant a plan to people by email for N days (admins). Returns the emails that have no account yet.
create or replace function public.ttm_grant_plan(p_emails text[], p_plan text, p_days int, p_note text default 'giveaway') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_found text[]; v_missing text[]; v_until timestamptz;
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  if p_plan not in ('free','crypto','tradfi','pro') then raise exception 'unknown plan'; end if;
  v_until := case when p_days is null then null else now() + make_interval(days => p_days) end;
  with em as (select distinct lower(btrim(x)) as e from unnest(p_emails) x where btrim(x) <> ''),
       up as (update public.ttm_profiles p set plan = p_plan, plan_until = v_until, plan_note = p_note
               from em where lower(p.email) = em.e and not p.is_admin returning p.email)
  select coalesce(array_agg(email), '{}') into v_found from up;
  select coalesce(array_agg(e), '{}') into v_missing from (select distinct lower(btrim(x)) as e from unnest(p_emails) x where btrim(x) <> '') em
   where e not in (select lower(email) from public.ttm_profiles);
  return jsonb_build_object('granted', v_found, 'no_account', v_missing, 'until', v_until);
end $$;
revoke all on function public.ttm_grant_plan(text[], text, int, text) from public, anon;
grant execute on function public.ttm_grant_plan(text[], text, int, text) to authenticated;

-- Optional: run the clean-up every hour on the server (skipped quietly if pg_cron is not enabled).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'ttm_expire_plans';
    perform cron.schedule('ttm_expire_plans', '5 * * * *', 'select public.ttm_expire_plans()');
  end if;
exception when others then raise notice 'pg_cron not set up: %', sqlerrm;
end $$;
