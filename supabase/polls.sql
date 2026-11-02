-- Polls in the community rooms (admin creates, everyone with room access votes). Safe to run more than once.
alter table public.ttm_room_msgs add column if not exists poll jsonb;

create table if not exists public.ttm_room_votes (
  msg_id  bigint not null references public.ttm_room_msgs(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  opt     int not null check (opt between 0 and 9),
  primary key (msg_id, user_id, opt)
);
alter table public.ttm_room_votes enable row level security;
drop policy if exists p_vt_sel on public.ttm_room_votes;
create policy p_vt_sel on public.ttm_room_votes for select to authenticated
  using (exists (select 1 from public.ttm_room_msgs m where m.id = msg_id and public.ttm_room_ok(m.room)));
drop policy if exists p_vt_ins on public.ttm_room_votes;
create policy p_vt_ins on public.ttm_room_votes for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.ttm_room_msgs m where m.id = msg_id and m.poll is not null and public.ttm_room_ok(m.room)
      and jsonb_array_length(m.poll -> 'opts') > opt
      and not exists (select 1 from public.ttm_room_mutes mu where mu.user_id = auth.uid() and mu.room in ('all', m.room))));
drop policy if exists p_vt_del on public.ttm_room_votes;
create policy p_vt_del on public.ttm_room_votes for delete to authenticated using (user_id = auth.uid() or public.ttm_is_admin());
revoke all on public.ttm_room_votes from anon, authenticated;
grant select, insert, delete on public.ttm_room_votes to authenticated;

-- single-answer polls: a new vote replaces the member's earlier one
create or replace function public.ttm_vote_single() returns trigger
language plpgsql security definer set search_path = public as $$
declare multi boolean;
begin
  select coalesce((poll ->> 'multi')::boolean, false) into multi from public.ttm_room_msgs where id = new.msg_id;
  if not multi then delete from public.ttm_room_votes where msg_id = new.msg_id and user_id = new.user_id and opt <> new.opt; end if;
  return new;
end $$;
drop trigger if exists ttm_vote_single on public.ttm_room_votes;
create trigger ttm_vote_single before insert on public.ttm_room_votes for each row execute function public.ttm_vote_single();

-- only admins can post polls (keeps the existing name and slow-mode rules)
create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.poll is not null and not public.ttm_is_admin() then raise exception 'Only TTM can post polls'; end if;
  select tg_handle into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  if exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;
