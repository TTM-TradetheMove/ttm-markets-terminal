-- Emoji reactions on community room messages. Safe to run more than once.
create table if not exists public.ttm_room_reacts (
  msg_id  bigint not null references public.ttm_room_msgs(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  emoji   text not null check (emoji in ('👍','🔥','🚀','😂','❤️','👀')),
  primary key (msg_id, user_id, emoji)
);
alter table public.ttm_room_reacts enable row level security;
drop policy if exists p_rx_sel on public.ttm_room_reacts;
create policy p_rx_sel on public.ttm_room_reacts for select to authenticated
  using (exists (select 1 from public.ttm_room_msgs m where m.id = msg_id and public.ttm_room_ok(m.room)));
drop policy if exists p_rx_ins on public.ttm_room_reacts;
create policy p_rx_ins on public.ttm_room_reacts for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.ttm_room_msgs m where m.id = msg_id and public.ttm_room_ok(m.room)
      and not exists (select 1 from public.ttm_room_mutes mu where mu.user_id = auth.uid() and mu.room in ('all', m.room))));
drop policy if exists p_rx_del on public.ttm_room_reacts;
create policy p_rx_del on public.ttm_room_reacts for delete to authenticated using (user_id = auth.uid() or public.ttm_is_admin());
revoke all on public.ttm_room_reacts from anon, authenticated;
grant select, insert, delete on public.ttm_room_reacts to authenticated;
