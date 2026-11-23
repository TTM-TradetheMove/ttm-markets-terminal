-- Live sessions for the TTM Team only, or for Beta testers only.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run (safe to run again).
-- Run supabase/live_tiers.sql first (already done if Live sessions work today).

-- 1) Who is in a group: Team = Team members and admin; Beta = Beta testers, Team members and admin
create or replace function public.ttm_in_group(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when g = 'team' then coalesce((select is_admin or coalesce(team, false) from public.ttm_profiles where id = auth.uid()), false)
    when g = 'beta' then coalesce((select is_admin or coalesce(team, false) or coalesce(beta, false) from public.ttm_profiles where id = auth.uid()), false)
    else true end
$$;
grant execute on function public.ttm_in_group(text) to authenticated;

-- 2) Two new choices for who a session is for
alter table public.ttm_live drop constraint if exists ttm_live_min_tier_chk;
alter table public.ttm_live add constraint ttm_live_min_tier_chk check (min_tier in ('free', 'premium', 'pro', 'team', 'beta'));

-- 3) The Zoom link is only handed over to the right people
create or replace function public.ttm_live_link(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select case
    when min_tier in ('team', 'beta') then case when public.ttm_in_group(min_tier) then zoom_url else null end
    when public.ttm_my_tier() >= public.ttm_tier(min_tier) then zoom_url
    else null end
  from public.ttm_live where id = p_id
$$;
grant execute on function public.ttm_live_link(bigint) to authenticated;

-- 4) Team and Beta sessions are not even listed for anyone outside the group
drop policy if exists p_lv_sel on public.ttm_live;
create policy p_lv_sel on public.ttm_live for select to authenticated
  using (min_tier not in ('team', 'beta') or public.ttm_in_group(min_tier));
