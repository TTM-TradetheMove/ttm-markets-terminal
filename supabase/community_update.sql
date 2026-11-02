-- Community update: deleting messages, room alerts, name rules, clearing test data. Safe to run more than once.

-- 1. Delete rights. TTM can delete any message. Members can delete their own.
drop policy if exists p_rmsg_del on public.ttm_room_msgs;
create policy p_rmsg_del on public.ttm_room_msgs for delete using (user_id = auth.uid() or public.ttm_is_admin());
grant select, insert, delete on public.ttm_room_msgs to authenticated;

drop policy if exists p_ch_del on public.ttm_chat;
create policy p_ch_del on public.ttm_chat for delete using (public.ttm_is_admin() or (member_id = auth.uid() and from_admin = false));
grant select, insert, delete on public.ttm_chat to authenticated;

-- 2. Phone alerts for room messages (sent once per message by the function)
alter table public.ttm_room_msgs add column if not exists pushed boolean not null default false;
update public.ttm_room_msgs set pushed = true where pushed = false;
grant update (pushed) on public.ttm_room_msgs to service_role;

-- 3. Name rules: no duplicates, and "TTM" in a name is only for TTM admins and the test account
create or replace function public.ttm_set_tg(p_handle text) returns void
language plpgsql security definer set search_path = public as $$
declare v text; me record; k text;
begin
  v := nullif(left(regexp_replace(coalesce(p_handle,''), '[^A-Za-z0-9_]', '', 'g'), 32), '');
  select is_admin, lower(coalesce(email,'')) as email into me from public.ttm_profiles where id = auth.uid();
  if v is not null then
    k := regexp_replace(lower(v), '[^a-z]', '', 'g');
    if k like '%ttm%' and not (coalesce(me.is_admin, false) or me.email = 'gro-coaching@outlook.com') then
      raise exception 'name_ttm';
    end if;
    if exists (select 1 from public.ttm_profiles where id <> auth.uid() and lower(tg_handle) = lower(v)) then
      raise exception 'name_taken';
    end if;
  end if;
  update public.ttm_profiles set tg_handle = v where id = auth.uid();
end $$;
grant execute on function public.ttm_set_tg(text) to authenticated;
do $$ begin
  create unique index if not exists ttm_profiles_tg_unique on public.ttm_profiles (lower(tg_handle)) where tg_handle is not null;
exception when others then
  raise notice 'Two members already share a name, so the unique index was skipped. The function above still blocks new duplicates.';
end $$;

-- Room messages show the Telegram name, or "Member-xxxx" (never part of an email address)
create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select tg_handle into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  if exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;

-- 4. Clear the test moves from "Recent buys" on the Holdings page
delete from public.ttm_spot_feed;
