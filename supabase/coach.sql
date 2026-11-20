-- TTM Trade Coach: counts each member's questions per day (limit is set in the function). Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists public.ttm_coach_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ttm_coach_usage enable row level security;   -- no policies: only the function (service role) can read or write it
