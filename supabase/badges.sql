-- Chat badges: TTM for admins, TTM Team for members you tick in Admin. Run once in the Supabase SQL editor.
alter table public.ttm_profiles add column if not exists team boolean not null default false;
alter table public.ttm_room_msgs add column if not exists badge text;

create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if to_jsonb(new)->>'poll' is not null and not public.ttm_is_admin() then raise exception 'Only TTM can post polls'; end if;
  if new.img is not null and new.img not like '%/storage/v1/object/public/room-images/' || new.user_id::text || '/%' then
    raise exception 'Images must be scanned first';
  end if;
  select tg_handle, is_admin, team into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  new.badge := case when p.is_admin then 'TTM' when p.team then 'TTM Team' else null end;
  if exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;

-- when you tick or untick TTM Team, their earlier messages follow
create or replace function public.ttm_badge_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.ttm_room_msgs set badge = case when new.is_admin then 'TTM' when new.team then 'TTM Team' else null end where user_id = new.id;
  return new;
end $$;
drop trigger if exists ttm_badge_sync on public.ttm_profiles;
create trigger ttm_badge_sync after update of team, is_admin on public.ttm_profiles for each row execute function public.ttm_badge_sync();

-- badge the messages already in the rooms
update public.ttm_room_msgs m set badge = 'TTM' from public.ttm_profiles p where p.id = m.user_id and p.is_admin;
