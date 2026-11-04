-- Members choose which chat rooms a message goes to, limited to the rooms their plan can use.
-- People you give the TTM Team or Moderator tag (Admin > member chips) can use every room.
-- Run once in the Supabase SQL editor. Safe to run again. Run badges2.sql and voice.sql first.
create or replace function public.ttm_room_ok(rm text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select is_admin, coalesce(beta, false) as beta, plan_until, coalesce(badges, '{}') as badges,
           case when plan in ('crypto','tradfi') then 'premium' else coalesce(plan, 'free') end as plan
    from public.ttm_profiles where id = auth.uid()),
  acc as (
    select coalesce((select value from public.ttm_settings where key = 'access') -> ('room:' || rm),
      case rm when 'free' then '["free","premium","pro"]'::jsonb when 'premium' then '["premium","pro"]'::jsonb else '["pro"]'::jsonb end) as a)
  select coalesce((select me.is_admin or ('team' = any(me.badges)) or ('mod' = any(me.badges)) or (acc.a ? 'free')
      or (acc.a ? (case when me.plan <> 'free' and me.plan_until is not null and me.plan_until < now() then 'free' else me.plan end))
      or (me.beta and (acc.a ? 'beta')) from me, acc), false)
$$;
grant execute on function public.ttm_room_ok(text) to authenticated;

-- same message to several rooms is one send: the "slow down" rule only counts earlier sends, not the same one
create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if to_jsonb(new)->>'poll' is not null and not public.ttm_is_admin() then raise exception 'Only TTM can post polls'; end if;
  if new.img is not null and new.img not like '%/storage/v1/object/public/room-images/' || new.user_id::text || '/%' then
    raise exception 'Images must be scanned first';
  end if;
  if new.audio is not null and new.audio not like '%/storage/v1/object/public/room-voice/' || new.user_id::text || '/%' then
    raise exception 'Voice notes must be uploaded from the chat';
  end if;
  select tg_handle, is_admin, badges into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  new.badges := public.ttm_badges_of(p.is_admin, p.badges);
  new.badge := case when p.is_admin then 'TTM' when 'team' = any(coalesce(p.badges, '{}')) then 'TTM Team' else null end;
  if not coalesce(p.is_admin, false) and exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds' and ts < now()) then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;
