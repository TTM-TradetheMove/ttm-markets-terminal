-- Member badges: TTM (admins, automatic) plus ones you switch on in Admin: TTM Team, Alpha, Mindset, Moderator, Founding Member.
-- Run once in the Supabase SQL editor. Safe to run again, and safe if badges.sql was already run.
alter table public.ttm_profiles add column if not exists team boolean not null default false;
alter table public.ttm_profiles add column if not exists badges text[] not null default '{}';
update public.ttm_profiles set badges = array_append(badges, 'team') where team and not ('team' = any(badges));
alter table public.ttm_room_msgs add column if not exists badge text;
alter table public.ttm_room_msgs add column if not exists badges text[] not null default '{}';

create or replace function public.ttm_badges_of(adm boolean, b text[]) returns text[]
language sql immutable as $$ select case when adm then array['ttm'] else '{}'::text[] end || coalesce(b, '{}'::text[]) $$;

create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if to_jsonb(new)->>'poll' is not null and not public.ttm_is_admin() then raise exception 'Only TTM can post polls'; end if;
  if new.img is not null and new.img not like '%/storage/v1/object/public/room-images/' || new.user_id::text || '/%' then
    raise exception 'Images must be scanned first';
  end if;
  select tg_handle, is_admin, badges into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  new.badges := public.ttm_badges_of(p.is_admin, p.badges);
  new.badge := case when p.is_admin then 'TTM' when 'team' = any(coalesce(p.badges, '{}')) then 'TTM Team' else null end;
  if exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;

-- when you change someone's badges, their earlier messages follow
create or replace function public.ttm_badge_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.ttm_room_msgs set badges = public.ttm_badges_of(new.is_admin, new.badges),
    badge = case when new.is_admin then 'TTM' when 'team' = any(coalesce(new.badges, '{}')) then 'TTM Team' else null end where user_id = new.id;
  return new;
end $$;
drop trigger if exists ttm_badge_sync on public.ttm_profiles;
create trigger ttm_badge_sync after update of team, badges, is_admin on public.ttm_profiles for each row execute function public.ttm_badge_sync();

-- Founding Member for the first N people who signed up (admin only)
create or replace function public.ttm_grant_founding(n int) returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  with first_n as (select id from public.ttm_profiles order by created_at asc limit greatest(n, 0))
  update public.ttm_profiles p set badges = array_append(p.badges, 'founding') from first_n f where p.id = f.id and not ('founding' = any(p.badges));
  get diagnostics c = row_count; return c;
end $$;
grant execute on function public.ttm_grant_founding(int) to authenticated;

-- badge the messages already in the rooms
update public.ttm_room_msgs m set badges = public.ttm_badges_of(p.is_admin, p.badges),
  badge = case when p.is_admin then 'TTM' when 'team' = any(coalesce(p.badges, '{}')) then 'TTM Team' else null end
from public.ttm_profiles p where p.id = m.user_id and (p.is_admin or cardinality(p.badges) > 0);
