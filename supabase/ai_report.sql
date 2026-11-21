-- TTM AI reports (Ask TTM AI under the Daily Brief): counts each member's reports per day (limits are set in the function).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists public.ttm_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ttm_ai_usage enable row level security;   -- no policies: only the function (service role) can read or write it
