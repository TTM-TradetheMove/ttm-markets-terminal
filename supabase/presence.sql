-- Who is online (members with the site open on screen). Safe to run more than once.
create table if not exists public.ttm_presence (
  user_id uuid primary key default auth.uid(),
  name    text not null default '',
  seen    timestamptz not null default now(),
  hidden  boolean not null default false
);
alter table public.ttm_presence enable row level security;
drop policy if exists p_pr_sel on public.ttm_presence;
create policy p_pr_sel on public.ttm_presence for select to authenticated
  using (user_id = auth.uid() or (hidden = false and seen > now() - interval '2 minutes'));
drop policy if exists p_pr_ins on public.ttm_presence;
create policy p_pr_ins on public.ttm_presence for insert to authenticated with check (user_id = auth.uid());
drop policy if exists p_pr_upd on public.ttm_presence;
create policy p_pr_upd on public.ttm_presence for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.ttm_presence from anon, authenticated;
grant select, insert, update on public.ttm_presence to authenticated;

-- the name always comes from the profile, never from the browser
create or replace function public.ttm_presence_fix() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select tg_handle into t from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(t, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  new.seen := now();
  return new;
end $$;
drop trigger if exists ttm_presence_fix on public.ttm_presence;
create trigger ttm_presence_fix before insert or update on public.ttm_presence for each row execute function public.ttm_presence_fix();
