-- Live sessions: a second phone push when the session starts ("We are live now").
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Then redeploy the push-spot function.
alter table public.ttm_live add column if not exists live_sent boolean not null default false;
-- sessions that already started should not fire retroactively
update public.ttm_live set live_sent = true where starts_at < now();
