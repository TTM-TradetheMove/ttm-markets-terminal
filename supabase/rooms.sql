-- TTM community chat rooms (Free / Premium / Pro). Safe to run more than once.
-- Who can read and write each room follows the tick boxes in Admin (rows "Chat room · ...").

create or replace function public.ttm_room_ok(rm text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select is_admin, coalesce(beta, false) as beta, plan_until,
           case when plan in ('crypto','tradfi') then 'premium' else coalesce(plan, 'free') end as plan
    from public.ttm_profiles where id = auth.uid()),
  acc as (
    select coalesce((select value from public.ttm_settings where key = 'access') -> ('room:' || rm),
      case rm when 'free' then '["free","premium","pro"]'::jsonb when 'premium' then '["premium","pro"]'::jsonb else '["pro"]'::jsonb end) as a)
  select coalesce((select me.is_admin or (acc.a ? 'free')
      or (acc.a ? (case when me.plan <> 'free' and me.plan_until is not null and me.plan_until < now() then 'free' else me.plan end))
      or (me.beta and (acc.a ? 'beta')) from me, acc), false)
$$;
grant execute on function public.ttm_room_ok(text) to authenticated;

create table if not exists public.ttm_room_mutes (
  user_id uuid not null,
  room    text not null check (room in ('all','free','premium','pro')),
  created timestamptz not null default now(),
  primary key (user_id, room)
);
alter table public.ttm_room_mutes enable row level security;
drop policy if exists p_rm_sel on public.ttm_room_mutes;
create policy p_rm_sel on public.ttm_room_mutes for select using (user_id = auth.uid() or public.ttm_is_admin());
drop policy if exists p_rm_ins on public.ttm_room_mutes;
create policy p_rm_ins on public.ttm_room_mutes for insert with check (public.ttm_is_admin());
drop policy if exists p_rm_del on public.ttm_room_mutes;
create policy p_rm_del on public.ttm_room_mutes for delete using (public.ttm_is_admin());
revoke all on public.ttm_room_mutes from anon, authenticated;
grant select, insert, delete on public.ttm_room_mutes to authenticated;

create table if not exists public.ttm_room_msgs (
  id      bigint generated always as identity primary key,
  room    text not null check (room in ('free','premium','pro')),
  user_id uuid not null default auth.uid(),
  name    text not null default '',
  body    text not null default '' check (char_length(body) <= 1000),
  img     text,
  ts      timestamptz not null default now(),
  constraint ttm_room_has_content check (char_length(body) > 0 or img is not null)
);
create index if not exists ttm_room_msgs_idx on public.ttm_room_msgs (room, id desc);
alter table public.ttm_room_msgs enable row level security;
drop policy if exists p_rmsg_sel on public.ttm_room_msgs;
create policy p_rmsg_sel on public.ttm_room_msgs for select using (public.ttm_room_ok(room));
drop policy if exists p_rmsg_ins on public.ttm_room_msgs;
create policy p_rmsg_ins on public.ttm_room_msgs for insert with check (
  user_id = auth.uid() and public.ttm_room_ok(room)
  and not exists (select 1 from public.ttm_room_mutes m where m.user_id = auth.uid() and m.room in ('all', room)));
drop policy if exists p_rmsg_del on public.ttm_room_msgs;
create policy p_rmsg_del on public.ttm_room_msgs for delete using (user_id = auth.uid() or public.ttm_is_admin());
revoke all on public.ttm_room_msgs from anon, authenticated;
grant select, insert, delete on public.ttm_room_msgs to authenticated;

-- fills in the sender name and stops flooding (one message every 3 seconds)
create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select tg_handle, email into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), split_part(coalesce(p.email, 'member'), '@', 1));
  if exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;
drop trigger if exists ttm_room_before_ins on public.ttm_room_msgs;
create trigger ttm_room_before_ins before insert on public.ttm_room_msgs for each row execute function public.ttm_room_before();

-- screenshots (2 MB max, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-images', 'room-images', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];
drop policy if exists p_room_img_ins on storage.objects;
create policy p_room_img_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'room-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists p_room_img_sel on storage.objects;
create policy p_room_img_sel on storage.objects for select using (bucket_id = 'room-images');
drop policy if exists p_room_img_del on storage.objects;
create policy p_room_img_del on storage.objects for delete to authenticated
  using (bucket_id = 'room-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.ttm_is_admin()));
