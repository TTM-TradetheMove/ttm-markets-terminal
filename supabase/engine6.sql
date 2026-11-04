-- Auto time frame: the agent can move to a better time frame when the current one is not working (and sends you an alert).
-- Run once in the Supabase SQL editor. Safe to run again.
alter table public.ttm_engine_config add column if not exists auto_tf boolean not null default false;
alter table public.ttm_engine_config add column if not exists tf_allowed text[] not null default '{15m,30m,1H,2H,4H,8H,12H}';
alter table public.ttm_engine_config add column if not exists tf_changed_at timestamptz;
alter table public.ttm_engine_positions add column if not exists timeframe text;
grant update (auto_tf, tf_allowed) on public.ttm_engine_config to authenticated;
