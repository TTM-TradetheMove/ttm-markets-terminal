-- TTM: name rules. No duplicate names, and any name containing TTM (even spaced or with symbols, e.g. T.T.M) is only for admins and the TTMMod account. Safe to run again.
create or replace function public.ttm_set_tg(p_handle text) returns void
language plpgsql security definer set search_path = public as $$
declare v text; me record; k text;
begin
  v := nullif(left(regexp_replace(coalesce(p_handle,''), '[^A-Za-z0-9_]', '', 'g'), 32), '');
  select is_admin, lower(coalesce(email,'')) as email into me from public.ttm_profiles where id = auth.uid();
  if v is not null then
    k := regexp_replace(lower(v), '[^a-z]', '', 'g');
    if k like '%ttm%' and not (coalesce(me.is_admin, false) or me.email in ('gro-coaching@outlook.com')) then
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
