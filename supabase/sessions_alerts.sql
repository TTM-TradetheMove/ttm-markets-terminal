-- Market session phone alerts: remembers which alerts have been sent, so each goes out once. Safe to run more than once.
create table if not exists public.ttm_session_fired (
  ukey text primary key,
  sent timestamptz not null default now()
);
alter table public.ttm_session_fired enable row level security;
revoke all on public.ttm_session_fired from anon, authenticated;
-- tidy old entries
delete from public.ttm_session_fired where sent < now() - interval '30 days';
