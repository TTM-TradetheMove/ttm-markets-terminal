-- Chat: members can edit their own messages, and TTM (admin) can see who has read its messages.
-- Run once in the Supabase SQL editor. Safe to run again. Run rooms.sql, badges2.sql and voice.sql first.

-- 1) editing: the author can change the text of their own message (never the room, images, voice note or polls)
alter table public.ttm_room_msgs add column if not exists edited_at timestamptz;
create or replace function public.ttm_room_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.body is distinct from old.body then
    if auth.uid() is distinct from old.user_id then raise exception 'Only the author can edit a message'; end if;
    if to_jsonb(old)->>'poll' is not null then raise exception 'Polls cannot be edited'; end if;
    if char_length(coalesce(new.body, '')) > 1000 then raise exception 'Message too long'; end if;
    if char_length(btrim(coalesce(new.body, ''))) = 0 and old.img is null and old.audio is null then raise exception 'A message cannot be empty'; end if;
    new.edited_at := now();
  end if;
  if new.user_id <> old.user_id or new.room <> old.room or new.img is distinct from old.img or new.audio is distinct from old.audio then
    raise exception 'Only the text can be changed';
  end if;
  return new;
end $$;
drop trigger if exists ttm_room_edit_upd on public.ttm_room_msgs;
create trigger ttm_room_edit_upd before update on public.ttm_room_msgs for each row execute function public.ttm_room_edit();
drop policy if exists p_rmsg_upd on public.ttm_room_msgs;
create policy p_rmsg_upd on public.ttm_room_msgs for update
  using (user_id = auth.uid() and public.ttm_room_ok(room) and not exists (select 1 from public.ttm_room_mutes m where m.user_id = auth.uid() and m.room in ('all', room)))
  with check (user_id = auth.uid());
grant update (body) on public.ttm_room_msgs to authenticated;

-- 2) read receipts: each member's last read message per room. Members can only write their own row. Only TTM can look at the results.
create table if not exists public.ttm_room_reads (
  user_id uuid not null,
  room text not null,
  last_id bigint not null default 0,
  ts timestamptz not null default now(),
  primary key (user_id, room)
);
alter table public.ttm_room_reads enable row level security;
drop policy if exists p_rr_sel on public.ttm_room_reads;
create policy p_rr_sel on public.ttm_room_reads for select using (user_id = auth.uid() or public.ttm_is_admin());
drop policy if exists p_rr_ins on public.ttm_room_reads;
create policy p_rr_ins on public.ttm_room_reads for insert with check (user_id = auth.uid() and public.ttm_room_ok(room));
drop policy if exists p_rr_upd on public.ttm_room_reads;
create policy p_rr_upd on public.ttm_room_reads for update using (user_id = auth.uid()) with check (user_id = auth.uid() and public.ttm_room_ok(room));
revoke all on public.ttm_room_reads from anon, authenticated;
grant select, insert, update on public.ttm_room_reads to authenticated;
create or replace function public.ttm_reads_guard() returns trigger language plpgsql as $$
begin if tg_op = 'UPDATE' and new.last_id < old.last_id then new.last_id := old.last_id; end if; return new; end $$;
drop trigger if exists ttm_reads_guard on public.ttm_room_reads;
create trigger ttm_reads_guard before update on public.ttm_room_reads for each row execute function public.ttm_reads_guard();

-- how many members have read each of these messages (admin only)
create or replace function public.ttm_seen_counts(rm text, ids bigint[]) returns table(id bigint, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  return query
    select g.mid, (select count(*)::int from public.ttm_room_reads r where r.room = rm and r.last_id >= g.mid and r.user_id <> m.user_id)
    from unnest(ids) as g(mid) join public.ttm_room_msgs m on m.id = g.mid and m.room = rm;
end $$;
grant execute on function public.ttm_seen_counts(text, bigint[]) to authenticated;

-- who has read one message (admin only)
create or replace function public.ttm_seen_by(msg_id bigint) returns table(name text, seen timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare rm text; au uuid;
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  select room, user_id into rm, au from public.ttm_room_msgs where ttm_room_msgs.id = msg_id;
  return query
    select coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(r.user_id::text, 1, 4)), r.ts
    from public.ttm_room_reads r left join public.ttm_profiles p on p.id = r.user_id
    where r.room = rm and r.last_id >= msg_id and r.user_id <> au order by r.ts desc limit 300;
end $$;
grant execute on function public.ttm_seen_by(bigint) to authenticated;
