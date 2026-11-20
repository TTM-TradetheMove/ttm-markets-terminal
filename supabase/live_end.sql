-- Live sessions: the Zoom link stays on the banner until you press "End session" (or 6 hours after the start, as a safety stop).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
alter table public.ttm_live add column if not exists ended_at timestamptz;
-- members can read every column except the Zoom link (same rule as live_tiers.sql), now including ended_at
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ttm_live' and column_name <> 'zoom_url';
  execute 'revoke select on public.ttm_live from authenticated';
  execute 'grant select (' || cols || ') on public.ttm_live to authenticated';
end $$;
