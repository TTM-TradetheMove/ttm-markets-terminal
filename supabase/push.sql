-- Phone push subscriptions (Pro members' devices). Safe to run more than once.
create table if not exists public.ttm_push_subs (
  endpoint text primary key,
  user_id  uuid not null default auth.uid(),
  p256dh   text not null,
  auth     text not null,
  created  timestamptz not null default now()
);
alter table public.ttm_push_subs enable row level security;
drop policy if exists p_ps_all on public.ttm_push_subs;
create policy p_ps_all on public.ttm_push_subs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.ttm_is_pro());
grant select, insert, update, delete on public.ttm_push_subs to authenticated;
