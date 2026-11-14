-- Live sessions: choose which plan can use the Zoom link (Free / Premium / Pro).
-- Run once in the Supabase SQL editor (safe to run again). Run it BEFORE deploying the push-spot function.

-- 1) Which plan a session needs
alter table public.ttm_live add column if not exists min_tier text not null default 'free';
alter table public.ttm_live drop constraint if exists ttm_live_min_tier_chk;
alter table public.ttm_live add constraint ttm_live_min_tier_chk check (min_tier in ('free', 'premium', 'pro'));

-- 2) The plan level of whoever is asking: admin = 2, Pro = 2, Premium = 1, Free (or expired) = 0
create or replace function public.ttm_my_tier() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when is_admin then 2
                               when plan_until is null or plan_until > now() then public.ttm_tier(plan)
                               else 0 end
                   from public.ttm_profiles where id = auth.uid()), 0)
$$;
grant execute on function public.ttm_my_tier() to authenticated;

-- 3) The only way to get a Zoom link: it is handed over only if the member's plan is high enough
create or replace function public.ttm_live_link(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select case when public.ttm_my_tier() >= public.ttm_tier(min_tier) then zoom_url else null end
  from public.ttm_live where id = p_id
$$;
grant execute on function public.ttm_live_link(bigint) to authenticated;

-- 4) Members can still see the session title, time and the plan needed, but can no longer read the zoom_url column itself
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ttm_live' and column_name <> 'zoom_url';
  execute 'revoke select on public.ttm_live from authenticated';
  execute 'grant select (' || cols || ') on public.ttm_live to authenticated';
end $$;
