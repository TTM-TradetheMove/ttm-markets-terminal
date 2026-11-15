-- Chat rooms follow the plan ladder: Free < Premium < Pro. A member can use every room at or below their own plan.
--   Free   -> Free room
--   Premium -> Free + Premium rooms
--   Pro    -> Free + Premium + Pro rooms
-- The Admin tick boxes for a room now set the LOWEST plan that can enter it (higher plans always come with it).
-- An expired plan counts as Free. Admins and anyone with a badge (TTM Team, Alpha, etc.) can use every room.
-- Run once in the Supabase SQL editor. Safe to run again.
create or replace function public.ttm_room_ok(rm text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select is_admin, coalesce(beta, false) as beta, coalesce(badges, '{}') as badges,
           case when plan_until is not null and plan_until < now() and coalesce(plan, 'free') <> 'free' then 0
                when plan = 'pro' then 2
                when plan in ('premium', 'crypto', 'tradfi') then 1
                else 0 end as r
    from public.ttm_profiles where id = auth.uid()),
  acc as (
    select coalesce((select value from public.ttm_settings where key = 'access') -> ('room:' || rm),
      case rm when 'free' then '["free","premium","pro"]'::jsonb when 'premium' then '["premium","pro"]'::jsonb else '["pro"]'::jsonb end) as a),
  need as (
    select coalesce((select min(case x when 'free' then 0 when 'premium' then 1 when 'pro' then 2 end)
                     from acc, jsonb_array_elements_text(acc.a) x where x in ('free', 'premium', 'pro')), 2) as n)
  select coalesce((select me.is_admin or (cardinality(me.badges) > 0) or me.r >= need.n
      or (me.beta and (acc.a ? 'beta')) from me, acc, need), false)
$$;
grant execute on function public.ttm_room_ok(text) to authenticated;
